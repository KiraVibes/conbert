import dns, { type LookupAddress, type LookupOptions } from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import { isPrivateHost } from '@conbert/core';

/**
 * Requests to the internet that must never reach this machine or the home
 * network – even when a public-looking name points to a private address
 * (DNS rebinding) or a site redirects there. The check runs when the
 * connection is opened, on the address that is really used.
 */

export class PrivateAddressError extends Error {
  readonly code = 'PRIVATE_ADDRESS';
  constructor(readonly host: string) {
    super(`${host} leads to a private address`);
    this.name = 'PrivateAddressError';
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** dns.lookup that refuses names with any private address. */
export function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    const first = addresses[0];
    if (!first || addresses.some((a) => isPrivateHost(a.address))) {
      callback(new PrivateAddressError(hostname), []);
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}

const connect = buildConnector({ lookup: publicLookup });

/** Connections only to public addresses (names are checked by publicLookup). */
const publicAgent = new Agent({
  connect(options, callback) {
    // IP addresses (also after a redirect) are not looked up: check them here.
    const host = options.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) !== 0 && isPrivateHost(host)) {
      callback(new PrivateAddressError(host), null);
      return;
    }
    connect(options, callback);
  },
});

/** fetch that only reaches public addresses. */
export function publicFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  // undici's own fetch: the built-in one takes no dispatcher of this undici version.
  // Its Response is the same class at runtime; the types differ only in detail.
  return undiciFetch(input, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: publicAgent,
  }) as unknown as Promise<Response>;
}

/** Was a request refused because it led into the home network? */
export function isPrivateAddressError(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof PrivateAddressError) return true;
    if (e instanceof AggregateError && e.errors.some(isPrivateAddressError)) return true;
  }
  return false;
}

/**
 * For programs that do their own requests (yt-dlp, gallery-dl): does the name
 * lead only to public addresses right now? The program looks the name up
 * again a moment later, so this narrows the gap but can't close it fully.
 */
export async function hostCheck(hostname: string): Promise<'public' | 'private' | 'unknown'> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) !== 0) return isPrivateHost(host) ? 'private' : 'public';
  if (isPrivateHost(host)) return 'private';
  try {
    const addresses = await dns.promises.lookup(host, { all: true });
    if (addresses.length === 0) return 'unknown';
    return addresses.some((a) => isPrivateHost(a.address)) ? 'private' : 'public';
  } catch {
    return 'unknown';
  }
}

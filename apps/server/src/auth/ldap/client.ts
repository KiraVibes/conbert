import { Client, InvalidCredentialsError } from 'ldapts';
import { HttpError } from '../../lib/http-error';

/** What Conbert needs to reach the directory. */
export interface LdapConnectionSettings {
  url: string;
  startTls: boolean;
  tlsVerify: boolean;
  caCert: string;
}

export interface LdapEntry {
  dn: string;
  /** Attribute name (lowercase) → values. */
  attrs: Record<string, string[]>;
}

export interface LdapSearch {
  scope?: 'base' | 'one' | 'sub';
  filter: string;
  attributes: string[];
}

/** One open connection. Always close it (finally). */
export interface LdapConnection {
  /** Throws InvalidCredentials (see isInvalidCredentials) for a wrong password. */
  bind(dn: string, password: string): Promise<void>;
  search(base: string, options: LdapSearch): Promise<LdapEntry[]>;
  close(): Promise<void>;
}

export type LdapConnector = (settings: LdapConnectionSettings) => Promise<LdapConnection>;

const TIMEOUT_MS = 10_000;

export class LdapInvalidCredentials extends Error {
  constructor() {
    super('invalid credentials');
    this.name = 'LdapInvalidCredentials';
  }
}

function toStrings(value: Buffer | Buffer[] | string[] | string): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v));
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** Turns low-level errors into errors the UI can explain. */
export function ldapError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof code === 'string') {
    if (NETWORK_CODES.has(code)) return new HttpError(502, 'LDAP_UNREACHABLE', code);
    if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
      return new HttpError(502, 'LDAP_TLS', `${code}: ${message}`);
    }
  }
  if (/timeout|timed out/i.test(message)) return new HttpError(504, 'LDAP_UNREACHABLE', message);
  if (/certificate|tls|ssl/i.test(message)) return new HttpError(502, 'LDAP_TLS', message);
  return new HttpError(502, 'LDAP_SEARCH_FAILED', message);
}

/** The real connection through ldapts. */
export const ldaptsConnector: LdapConnector = async (settings) => {
  const tlsOptions = {
    rejectUnauthorized: settings.tlsVerify,
    ...(settings.caCert ? { ca: [settings.caCert] } : {}),
  };
  const secure = /^ldaps:/i.test(settings.url);
  const client = new Client({
    url: settings.url,
    timeout: TIMEOUT_MS,
    connectTimeout: TIMEOUT_MS,
    // ldapts starts TLS right away whenever tlsOptions are set – only for ldaps://.
    ...(secure ? { tlsOptions } : {}),
    strictDN: false,
  });
  try {
    if (settings.startTls && !secure) await client.startTLS(tlsOptions);
  } catch (error) {
    await client.unbind().catch(() => undefined);
    throw ldapError(error);
  }
  return {
    async bind(dn, password) {
      // An empty password would be an "anonymous" bind that many servers accept.
      if (!password) throw new LdapInvalidCredentials();
      try {
        await client.bind(dn, password);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) throw new LdapInvalidCredentials();
        throw ldapError(error);
      }
    },
    async search(base, options) {
      try {
        const { searchEntries } = await client.search(base, {
          scope: options.scope ?? 'sub',
          filter: options.filter,
          attributes: options.attributes,
          paged: options.scope === 'base' ? false : { pageSize: 200 },
        });
        return searchEntries.map((entry) => {
          const attrs: Record<string, string[]> = {};
          for (const [key, value] of Object.entries(entry)) {
            if (key !== 'dn') attrs[key.toLowerCase()] = toStrings(value);
          }
          return { dn: entry.dn, attrs };
        });
      } catch (error) {
        // "No such object" for a missing base: an empty result is easier to handle.
        if ((error as { code?: unknown }).code === 32) return [];
        throw ldapError(error);
      }
    },
    async close() {
      await client.unbind().catch(() => undefined);
    },
  };
};

/** The first value of an attribute ('' if missing). */
export function first(entry: LdapEntry, attr: string): string {
  return entry.attrs[attr.toLowerCase()]?.[0] ?? '';
}

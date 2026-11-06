import { isAbortError, parseDownloadUrl } from '@conbert/core';
import { isPrivateAddressError, publicFetch } from '../lib/public-net';
import pkg from '../../package.json' with { type: 'json' };

/**
 * HTTP for booru sites: an honest User-Agent, a minimum time between two
 * requests per site (shared by all users and jobs), waiting on "too many
 * requests" – and never any trick to get around a block.
 */

export type BooruErrorCode =
  | 'BOORU_AUTH'
  | 'BOORU_NEEDS_ACCOUNT'
  | 'BOORU_RATE_LIMITED'
  | 'BOORU_BLOCKED'
  | 'BOORU_TAG_LIMIT'
  | 'BOORU_PAGE_LIMIT'
  | 'BOORU_UNREACHABLE'
  | 'BOORU_FAILED';

export class BooruError extends Error {
  constructor(
    readonly code: BooruErrorCode,
    readonly details?: string,
    /** For BOORU_RATE_LIMITED: how long the site asked to wait. */
    readonly retryAfterMs?: number,
  ) {
    super(details ? `${code}: ${details}` : code);
    this.name = 'BooruError';
  }
}

export function userAgent(username?: string | null, siteName?: string): string {
  // e621 asks for "project/version (by username on e621)".
  const by = username && siteName ? `; by ${username} on ${siteName}` : '';
  return `Conbert/${pkg.version} (self-hosted file converter${by})`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException('aborted', 'AbortError'),
      );
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** One gate per site: requests line up and keep their distance. */
class Gate {
  private next = 0;
  private tail: Promise<void> = Promise.resolve();

  wait(intervalMs: number, signal?: AbortSignal): Promise<void> {
    const turn = this.tail.then(async () => {
      const delay = this.next - Date.now();
      if (delay > 0) await sleep(delay, signal);
      this.next = Date.now() + intervalMs;
    });
    // A cancelled waiter must not block the ones behind it.
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  /** The site said "wait": nobody asks again before then. */
  holdUntil(time: number): void {
    this.next = Math.max(this.next, time);
  }
}

const gates = new Map<string, Gate>();
function gate(key: string): Gate {
  let g = gates.get(key);
  if (!g) {
    g = new Gate();
    gates.set(key, g);
  }
  return g;
}

/** Only so many files of one site at the same time. */
class Slots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly size: number) {}

  async take(): Promise<() => void> {
    if (this.active >= this.size) await new Promise<void>((r) => this.waiting.push(r));
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}
const slots = new Map<string, Slots>();
export function fileSlots(siteKey: string, size: number): Slots {
  let s = slots.get(siteKey);
  if (!s) {
    s = new Slots(size);
    slots.set(siteKey, s);
  }
  return s;
}

function retryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** Cloudflare & co. answering with a check page instead of the API. */
function isChallenge(res: Response): boolean {
  return (
    res.headers.get('cf-mitigated') === 'challenge' ||
    ((res.status === 403 || res.status === 503) &&
      (res.headers.get('server') ?? '').toLowerCase().includes('cloudflare') &&
      (res.headers.get('content-type') ?? '').includes('text/html'))
  );
}

function classifyMessage(message: string): BooruErrorCode | null {
  if (/more than \d+ tags|up to \d+ tags|too many tags|tag limit/i.test(message)) {
    return 'BOORU_TAG_LIMIT';
  }
  if (/beyond page|page limit|cannot go (past|beyond)/i.test(message)) return 'BOORU_PAGE_LIMIT';
  return null;
}

export interface BooruRequest {
  /** Requests of one site share a gate. */
  siteKey: string;
  intervalMs: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** How often to wait and try again on 429/503 or a lost connection. */
  retries?: number;
  /** Longest wait the site may ask for before giving up (crawls wait longer). */
  maxWaitMs?: number;
  /** Home-network addresses allowed (own instances, if the admin allows it). */
  allowPrivate?: boolean;
  timeoutMs?: number;
}

/** Address check: only http(s) to public hosts (unless allowed). */
export function checkedUrl(raw: string | URL, allowPrivate = false): URL | null {
  const text = String(raw);
  if (allowPrivate) {
    try {
      const url = new URL(text);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch {
      return null;
    }
  }
  return parseDownloadUrl(text);
}

/** A request with gate, waiting and error explanation. Returns an OK response. */
export async function booruRequest(url: URL, req: BooruRequest): Promise<Response> {
  if (!checkedUrl(url, req.allowPrivate)) throw new BooruError('BOORU_UNREACHABLE', 'address');
  const retries = req.retries ?? 1;
  const maxWait = req.maxWaitMs ?? 30_000;
  const g = gate(req.siteKey);
  for (let attempt = 0; ; attempt++) {
    await g.wait(req.intervalMs, req.signal);
    let res: Response;
    try {
      // Own instances in the home network only when the admin allows it.
      res = await (req.allowPrivate ? fetch : publicFetch)(url, {
        headers: { 'User-Agent': userAgent(), Accept: 'application/json', ...req.headers },
        signal: req.signal
          ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs ?? 30_000)])
          : AbortSignal.timeout(req.timeoutMs ?? 30_000),
        redirect: 'follow',
      });
    } catch (error) {
      // Cancelled by the user (a timeout is just another failed attempt).
      if (req.signal?.aborted && isAbortError(error)) throw error;
      if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      // The name (or a redirect) leads into the home network: no point in trying again.
      if (isPrivateAddressError(error)) throw new BooruError('BOORU_UNREACHABLE', 'address');
      if (attempt < retries) {
        await sleep(Math.min(maxWait, 5_000 * 2 ** attempt), req.signal);
        continue;
      }
      throw new BooruError(
        'BOORU_UNREACHABLE',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (res.ok) return res;
    if (isChallenge(res)) {
      await res.body?.cancel();
      throw new BooruError('BOORU_BLOCKED', `HTTP ${res.status}`);
    }
    if (res.status === 429 || res.status === 503) {
      const wait = retryAfter(res.headers.get('retry-after')) ?? 5_000 * 2 ** attempt;
      await res.body?.cancel();
      g.holdUntil(Date.now() + wait);
      if (attempt < retries && wait <= maxWait) continue;
      throw new BooruError('BOORU_RATE_LIMITED', `HTTP ${res.status}`, wait);
    }
    const text = (await res.text().catch(() => '')).slice(0, 2000);
    let message = text;
    try {
      const body = JSON.parse(text) as { message?: unknown; reason?: unknown };
      message = String(body.message ?? body.reason ?? text);
    } catch {
      // Not JSON – keep the text.
    }
    const known = classifyMessage(message);
    if (known) throw new BooruError(known, message.slice(0, 300));
    if (res.status === 401 || res.status === 403) {
      throw new BooruError('BOORU_AUTH', `HTTP ${res.status}`);
    }
    if (res.status >= 500 && attempt < retries) {
      await sleep(Math.min(maxWait, 5_000 * 2 ** attempt), req.signal);
      continue;
    }
    throw new BooruError('BOORU_FAILED', `HTTP ${res.status}: ${message.slice(0, 300)}`);
  }
}

/** JSON from a booru API; some old instances answer with XML (returned as text). */
export async function booruJson(url: URL, req: BooruRequest): Promise<unknown> {
  const res = await booruRequest(url, req);
  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('<')) return { xml: trimmed };
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new BooruError('BOORU_FAILED', 'invalid JSON');
  }
}

/** Reads a response body up to a size limit (thumbnails, files). */
export async function readLimited(res: Response, maxBytes: number): Promise<Buffer | null> {
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  if (!res.body) return Buffer.alloc(0);
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > maxBytes) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export { sleep };

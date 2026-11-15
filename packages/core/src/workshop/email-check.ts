/**
 * Email check: takes a saved email (.eml) apart and explains what's odd –
 * the route over the servers, whether the sender was verified (SPF, DKIM,
 * DMARC), a display name that pretends to be someone else, links whose text
 * shows another address than they lead to, dangerous attachments.
 * Nothing is opened or loaded: HTML is only read as text.
 */
import { isExecutableExt } from './executable';

export const MAIL_WARNINGS = [
  'dmarcFail',
  'spfFail',
  'dkimFail',
  'noAuth',
  'displayNameAddress',
  'replyToOther',
  'returnPathOther',
  'linkMismatch',
  'punycodeLink',
  'ipLink',
  'shortLink',
  'scriptLink',
  'dangerousAttachment',
  'macroAttachment',
  'htmlAttachment',
  'archiveAttachment',
  'pressureWords',
  'messageIdOther',
  'dateFuture',
] as const;
export type MailWarningKey = (typeof MAIL_WARNINGS)[number];
export type MailSeverity = 'high' | 'medium' | 'info';

export const MAIL_SEVERITY: Record<MailWarningKey, MailSeverity> = {
  dmarcFail: 'high',
  spfFail: 'medium',
  dkimFail: 'medium',
  noAuth: 'info',
  displayNameAddress: 'high',
  replyToOther: 'medium',
  returnPathOther: 'info',
  linkMismatch: 'high',
  punycodeLink: 'high',
  ipLink: 'medium',
  shortLink: 'medium',
  scriptLink: 'high',
  dangerousAttachment: 'high',
  macroAttachment: 'high',
  htmlAttachment: 'medium',
  archiveAttachment: 'info',
  pressureWords: 'info',
  messageIdOther: 'info',
  dateFuture: 'info',
};

export interface MailWarning {
  key: MailWarningKey;
  severity: MailSeverity;
  values: Record<string, string>;
}

export interface MailAddress {
  name: string;
  address: string;
  domain: string;
}

export interface MailHop {
  from: string;
  by: string;
  date: Date | null;
  /** Seconds since the hop before (null for the first or without dates). */
  delay: number | null;
}

export interface MailLink {
  url: string;
  text: string;
  domain: string;
}

export interface MailAttachment {
  name: string;
  type: string;
  size: number;
}

export type AuthResult = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'other';

export interface MailReport {
  from: MailAddress | null;
  replyTo: MailAddress | null;
  returnPath: string | null;
  to: string;
  subject: string;
  date: Date | null;
  messageId: string;
  hops: MailHop[];
  auth: { spf: AuthResult | null; dkim: AuthResult | null; dmarc: AuthResult | null; by: string };
  links: MailLink[];
  attachments: MailAttachment[];
  text: string;
  warnings: MailWarning[];
  verdict: 'danger' | 'caution' | 'ok';
}

interface Header {
  name: string;
  value: string;
}

/* ------------------------------------------------------------- parsing */

function splitHead(raw: string): { headers: Header[]; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers: Header[] = [];
  for (const line of head.split(/\r?\n/)) {
    const last = headers.at(-1);
    if (/^[ \t]/.test(line) && last) last.value += ` ${line.trim()}`;
    else {
      const c = line.indexOf(':');
      if (c > 0)
        headers.push({
          name: line.slice(0, c).trim().toLowerCase(),
          value: line.slice(c + 1).trim(),
        });
    }
  }
  return { headers, body };
}

const get = (h: Header[], name: string) => h.find((x) => x.name === name)?.value ?? '';
const all = (h: Header[], name: string) => h.filter((x) => x.name === name).map((x) => x.value);

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    const bin = atob(clean);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function qpBytes(s: string, header = false): Uint8Array {
  const t = (header ? s.replace(/_/g, ' ') : s).replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i] ?? '';
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(Number.parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(out);
}

/** Header text read byte by byte: raw UTF-8 (allowed in newer mail) becomes readable. */
function fixRaw(value: string): string {
  if (!/[\x80-\xff]/.test(value)) return value;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff),
    );
  } catch {
    return value;
  }
}

/** "=?utf-8?B?…?=" words in headers → text. */
export function decodeWords(value: string): string {
  return fixRaw(value)
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs: string, enc: string, text: string) =>
      decodeBytes(
        enc.toUpperCase() === 'B' ? base64Bytes(text) : qpBytes(text, true),
        cs.toLowerCase(),
      ),
    );
}

export function parseAddress(value: string): MailAddress | null {
  const v = decodeWords(value).trim();
  if (!v) return null;
  const angle = /^(.*?)<([^>]+)>\s*$/.exec(v);
  const address = (angle ? angle[2] : v)?.trim().replace(/^mailto:/i, '') ?? '';
  const name = (angle ? angle[1] : '')?.trim().replace(/^"|"$/g, '').trim() ?? '';
  const domain = address.split('@')[1]?.toLowerCase().replace(/[>\s]/g, '') ?? '';
  return { name, address, domain };
}

/** The main part of a domain ("mail.shop.example.com" → "example.com"), roughly. */
export function baseDomain(domain: string): string {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  // Two-part endings like co.uk, com.au, co.jp.
  const two =
    /^(co|com|net|org|gov|ac|edu)$/.test(parts.at(-2) ?? '') && (parts.at(-1)?.length ?? 0) === 2;
  return parts.slice(two ? -3 : -2).join('.');
}

function param(value: string, name: string): string {
  const m = new RegExp(`${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(value);
  const v = m?.[1] ?? m?.[2] ?? '';
  // RFC 2231: utf-8''name%20with%20spaces
  const ext = /^([\w-]+)''(.*)$/.exec(v);
  if (ext) {
    try {
      return decodeURIComponent(ext[2] ?? '');
    } catch {
      return ext[2] ?? '';
    }
  }
  return decodeWords(v);
}

interface Part {
  headers: Header[];
  body: string;
}

function decodeBody(part: Part): Uint8Array {
  const enc = get(part.headers, 'content-transfer-encoding').toLowerCase();
  if (enc === 'base64') return base64Bytes(part.body);
  if (enc === 'quoted-printable') return qpBytes(part.body);
  return Uint8Array.from(part.body, (c) => c.charCodeAt(0) & 0xff);
}

/** Walks the MIME tree: text parts and attachments. */
function walkMime(
  part: Part,
  out: { plain: string[]; html: string[]; attachments: MailAttachment[] },
  depth = 0,
) {
  const type = get(part.headers, 'content-type') || 'text/plain';
  const mime = type.split(';')[0]?.trim().toLowerCase() ?? 'text/plain';
  if (mime.startsWith('multipart/') && depth < 10) {
    const boundary = param(type, 'boundary');
    if (!boundary) return;
    const pieces = part.body.split(
      new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[^\\n]*\\n`),
    );
    for (const piece of pieces.slice(1)) {
      if (!piece.trim()) continue;
      walkMime(splitHead(piece), out, depth + 1);
    }
    return;
  }
  const disposition = get(part.headers, 'content-disposition');
  const name = param(disposition, 'filename') || param(type, 'name');
  if (/^attachment/i.test(disposition) || (name && !mime.startsWith('text/'))) {
    out.attachments.push({ name: name || '?', type: mime, size: decodeBody(part).length });
    return;
  }
  if (mime === 'message/rfc822') return;
  const text = decodeBytes(decodeBody(part), param(type, 'charset').toLowerCase());
  if (mime === 'text/html') out.html.push(text);
  else if (mime.startsWith('text/')) out.plain.push(text);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const unescapeHtml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1]?.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
        )
      : (ENTITIES[e.toLowerCase()] ?? m),
  );
const stripTags = (html: string) =>
  unescapeHtml(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i.exec(url.trim());
  return (m?.[1] ?? '').toLowerCase();
}

/** A visible link text that names an address ("www.bank.de", "https://…"). */
function textDomain(text: string): string {
  const m = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/\s]|$)/i.exec(text.trim());
  return m?.[1]?.toLowerCase() ?? '';
}

const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  's.id',
  't.ly',
  'shorturl.at',
  'tiny.cc',
  'rb.gy',
  'v.gd',
  'qrco.de',
  'lnkd.in',
]);

const PRESSURE = [
  'dringend',
  'sofort',
  'umgehend',
  'gesperrt',
  'sperrung',
  'eingeschränkt',
  'verifizieren',
  'bestätigen sie',
  'letzte mahnung',
  'innerhalb von 24',
  'passwort',
  'kennwort',
  'kontodaten',
  'urgent',
  'immediately',
  'suspended',
  'locked',
  'verify your',
  'confirm your',
  'within 24 hours',
  'password',
  'final notice',
  'unusual activity',
  'ungewöhnliche aktivität',
];

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(/\s*\([^)]*\)\s*$/, ''));
  return Number.isNaN(d.getTime()) ? null : d;
}

function authValue(text: string, method: string): AuthResult | null {
  const m = new RegExp(`\\b${method}\\s*=\\s*(\\w+)`, 'i').exec(text);
  if (!m) return null;
  const v = (m[1] ?? '').toLowerCase();
  return v === 'pass' || v === 'fail' || v === 'softfail' || v === 'neutral' || v === 'none'
    ? v
    : 'other';
}

/* -------------------------------------------------------------- report */

/** The email's bytes as text, one character per byte (each part is decoded later). */
export function emlText(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

export function checkEmail(raw: string): MailReport {
  const top = splitHead(raw);
  const h = top.headers;
  const from = parseAddress(get(h, 'from'));
  const replyTo = parseAddress(get(h, 'reply-to'));
  const returnPath = get(h, 'return-path').replace(/[<>]/g, '').trim() || null;
  const subject = decodeWords(get(h, 'subject'));
  const date = parseDate(get(h, 'date'));
  const messageId = get(h, 'message-id');

  // Received lines: the newest is on top – turn them around.
  const hops: MailHop[] = all(h, 'received')
    .reverse()
    .map((r) => {
      const fromHost = /\bfrom\s+(\S+)(?:\s+\(([^)]*)\))?/i.exec(r);
      const by = /\bby\s+([^\s;]+)/i.exec(r)?.[1] ?? '';
      const when = r.includes(';') ? parseDate(r.slice(r.lastIndexOf(';') + 1).trim()) : null;
      return {
        from: [fromHost?.[1], fromHost?.[2]].filter(Boolean).join(' ').trim(),
        by,
        date: when,
        delay: null,
      };
    });
  hops.forEach((hop, i) => {
    const before = hops[i - 1]?.date;
    if (i > 0 && before && hop.date)
      hop.delay = Math.round((hop.date.getTime() - before.getTime()) / 1000);
  });

  // The receiving server's verdict: the topmost Authentication-Results.
  const authText = all(h, 'authentication-results')[0] ?? '';
  const spfHeader = get(h, 'received-spf');
  const auth = {
    spf:
      authValue(authText, 'spf') ??
      (spfHeader ? authValue(`spf=${spfHeader.split(/\s/)[0] ?? ''}`, 'spf') : null),
    dkim: authValue(authText, 'dkim'),
    dmarc: authValue(authText, 'dmarc'),
    by: authText.split(';')[0]?.trim() ?? '',
  };

  const parts = {
    plain: [] as string[],
    html: [] as string[],
    attachments: [] as MailAttachment[],
  };
  walkMime(top, parts);
  const html = parts.html.join('\n');
  const text = (parts.plain.join('\n\n') || stripTags(html)).slice(0, 200_000);

  // Links: from HTML with their visible text, else from the plain text.
  const links: MailLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = unescapeHtml((m[1] ?? m[2] ?? m[3] ?? '').trim());
    const label = stripTags(m[4] ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    if (!url || url.startsWith('#') || /^mailto:/i.test(url)) continue;
    const key = `${url}\n${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url, text: label, domain: hostOf(url) });
  }
  if (links.length === 0)
    for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      links.push({ url: m[0], text: '', domain: hostOf(m[0]) });
    }

  const warnings: MailWarning[] = [];
  const warn = (key: MailWarningKey, values: Record<string, string> = {}) => {
    if (!warnings.some((w) => w.key === key))
      warnings.push({ key, severity: MAIL_SEVERITY[key], values });
  };
  if (auth.dmarc === 'fail')
    warn('dmarcFail', {
      domain: /header\.from=([^\s;]+)/i.exec(authText)?.[1] ?? from?.domain ?? '',
    });
  if (auth.spf === 'fail' || auth.spf === 'softfail') warn('spfFail');
  if (auth.dkim === 'fail') warn('dkimFail');
  if (!auth.spf && !auth.dkim && !auth.dmarc) warn('noAuth');

  if (from) {
    const named = /[\w.+-]+@([\w-]+\.)+[a-z]{2,}/i.exec(from.name)?.[0] ?? textDomain(from.name);
    const namedDomain = named.includes('@') ? (named.split('@')[1] ?? '') : named;
    if (namedDomain && baseDomain(namedDomain) !== baseDomain(from.domain))
      warn('displayNameAddress', { shown: named, real: from.address });
    if (replyTo && replyTo.domain && baseDomain(replyTo.domain) !== baseDomain(from.domain))
      warn('replyToOther', { replyTo: replyTo.address, from: from.address });
    const rp = returnPath?.split('@')[1];
    if (rp && baseDomain(rp) !== baseDomain(from.domain))
      warn('returnPathOther', { returnPath: returnPath ?? '' });
    const mid = /@([^>\s]+)/.exec(messageId)?.[1];
    if (mid && baseDomain(mid) !== baseDomain(from.domain)) warn('messageIdOther', { domain: mid });
  }

  for (const l of links) {
    if (/^(javascript|data|vbscript):/i.test(l.url))
      warn('scriptLink', { url: l.url.slice(0, 80) });
    const shown = textDomain(l.text);
    if (shown && l.domain && baseDomain(shown) !== baseDomain(l.domain))
      warn('linkMismatch', { shown, real: l.domain });
    if (l.domain.split('.').some((p) => p.startsWith('xn--')))
      warn('punycodeLink', { domain: l.domain });
    if (/^\d{1,3}(\.\d{1,3}){3}$|^\[/.test(l.domain)) warn('ipLink', { domain: l.domain });
    if (SHORTENERS.has(l.domain.replace(/^www\./, ''))) warn('shortLink', { domain: l.domain });
  }

  for (const a of parts.attachments) {
    const lower = a.name.toLowerCase();
    const ext = lower.split('.').pop() ?? '';
    const double =
      /\.(pdf|docx?|xlsx?|jpe?g|png|txt|zip)\.[a-z0-9]{2,4}$/.test(lower) && ext !== 'zip';
    if (isExecutableExt(ext) || double) warn('dangerousAttachment', { name: a.name });
    else if (/^(docm|xlsm|pptm|dotm|xlam|xltm|potm|ppsm)$/.test(ext))
      warn('macroAttachment', { name: a.name });
    else if (/^(html?|shtml|svg|xhtml)$/.test(ext)) warn('htmlAttachment', { name: a.name });
    else if (/^(zip|rar|7z|iso|img|vhd|cab|tar|gz)$/.test(ext))
      warn('archiveAttachment', { name: a.name });
  }

  const lowerText = `${subject}\n${text}`.toLowerCase();
  const pressing = PRESSURE.filter((w) => lowerText.includes(w));
  if (pressing.length) warn('pressureWords', { words: pressing.slice(0, 6).join(', ') });
  if (date && date.getTime() > Date.now() + 24 * 3600 * 1000) warn('dateFuture');

  const order: MailSeverity[] = ['high', 'medium', 'info'];
  warnings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const verdict = warnings.some((w) => w.severity === 'high')
    ? 'danger'
    : warnings.some((w) => w.severity === 'medium')
      ? 'caution'
      : 'ok';

  return {
    from,
    replyTo,
    returnPath,
    to: decodeWords(get(h, 'to')),
    subject,
    date,
    messageId,
    hops,
    auth,
    links,
    attachments: parts.attachments,
    text,
    warnings,
    verdict,
  };
}

/**
 * What goes into a QR code: plain text or a link, WLAN access, a contact
 * card. Phones recognise these formats and offer "join network" or "save
 * contact". The reverse direction explains what a scanned code contains.
 */

export const QR_KINDS = ['text', 'wifi', 'contact'] as const;
export type QrKind = (typeof QR_KINDS)[number];

export const WIFI_SECURITY = ['WPA', 'WEP', 'nopass'] as const;
export type WifiSecurity = (typeof WIFI_SECURITY)[number];

export interface WifiData {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

export interface ContactData {
  name: string;
  phone: string;
  email: string;
  org: string;
  url: string;
}

/** WLAN codes: \ ; , : and " are escaped with a backslash. */
const escapeWifi = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
/** vCard: \ , ; and line breaks are escaped. */
const escapeVcard = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/([,;])/g, '\\$1')
    .replace(/\r?\n/g, '\\n');

export function wifiPayload(w: WifiData): string {
  const parts = [`T:${w.security}`, `S:${escapeWifi(w.ssid)}`];
  if (w.security !== 'nopass') parts.push(`P:${escapeWifi(w.password)}`);
  if (w.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

export function contactPayload(c: ContactData): string {
  const name = c.name.trim();
  // Last word = family name (good enough for "Anna Beispiel").
  const space = name.lastIndexOf(' ');
  const family = space > 0 ? name.slice(space + 1) : name;
  const given = space > 0 ? name.slice(0, space) : '';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVcard(family)};${escapeVcard(given)};;;`,
    `FN:${escapeVcard(name)}`,
    ...(c.org.trim() ? [`ORG:${escapeVcard(c.org.trim())}`] : []),
    ...(c.phone.trim() ? [`TEL:${escapeVcard(c.phone.trim())}`] : []),
    ...(c.email.trim() ? [`EMAIL:${escapeVcard(c.email.trim())}`] : []),
    ...(c.url.trim() ? [`URL:${escapeVcard(c.url.trim())}`] : []),
    'END:VCARD',
  ];
  return lines.join('\r\n');
}

// --- Reading ---

export type QrMeaning =
  | { kind: 'url'; url: string }
  | { kind: 'wifi'; wifi: WifiData }
  | { kind: 'contact'; contact: ContactData; vcard: string }
  | { kind: 'email'; address: string }
  | { kind: 'phone'; number: string }
  | { kind: 'text'; text: string };

/** Splits at unescaped separators and removes the backslashes. */
function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? '';
    if (ch === '\\' && i + 1 < s.length) {
      cur += s[++i];
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseWifi(text: string): WifiData | null {
  if (!/^WIFI:/i.test(text)) return null;
  const fields = new Map<string, string>();
  for (const part of splitEscaped(text.slice(5), ';')) {
    const colon = part.indexOf(':');
    if (colon > 0) fields.set(part.slice(0, colon).toUpperCase(), part.slice(colon + 1));
  }
  const ssid = fields.get('S');
  if (ssid === undefined) return null;
  const t = (fields.get('T') ?? 'nopass').toUpperCase();
  return {
    ssid,
    password: fields.get('P') ?? '',
    security: t === 'WEP' ? 'WEP' : t === 'NOPASS' || t === '' ? 'nopass' : 'WPA',
    hidden: (fields.get('H') ?? '').toLowerCase() === 'true',
  };
}

function parseVcard(text: string): ContactData | null {
  if (!/^BEGIN:VCARD/i.test(text.trim())) return null;
  const contact: ContactData = { name: '', phone: '', email: '', org: '', url: '' };
  const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  for (const raw of text.split(/\r?\n/)) {
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const key = (raw.slice(0, colon).split(';')[0] ?? '').toUpperCase();
    const value = unescape(raw.slice(colon + 1));
    if (key === 'FN') contact.name = value;
    else if (key === 'TEL' && !contact.phone) contact.phone = value;
    else if (key === 'EMAIL' && !contact.email) contact.email = value;
    else if (key === 'ORG') contact.org = value.replace(/;+$/, '');
    else if (key === 'URL') contact.url = value;
    else if (key === 'N' && !contact.name) {
      const [family = '', given = ''] = value.split(';');
      contact.name = `${given} ${family}`.trim();
    }
  }
  return contact;
}

/** What a scanned code means, so the UI can show it in plain words. */
export function readQrContent(text: string): QrMeaning {
  const t = text.trim();
  const wifi = parseWifi(t);
  if (wifi) return { kind: 'wifi', wifi };
  const contact = parseVcard(t);
  if (contact) return { kind: 'contact', contact, vcard: t };
  if (/^https?:\/\/\S+$/i.test(t)) return { kind: 'url', url: t };
  const mail = /^mailto:([^?]+)/i.exec(t);
  if (mail?.[1]) return { kind: 'email', address: decodeURIComponent(mail[1]) };
  const tel = /^tel:(.+)$/i.exec(t);
  if (tel?.[1]) return { kind: 'phone', number: tel[1] };
  return { kind: 'text', text };
}

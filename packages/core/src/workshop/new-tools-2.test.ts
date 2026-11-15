import { describe, expect, it } from 'vitest';
import { bytesReader } from './reader';
import { applyPatches, datePatches, findMediaDates, shiftDateText } from './date-shift';
import { baseDomain, checkEmail, emlText } from './email-check';
import { posterPeaks, soundPosterSvg } from './sound-poster';
import { depthFromGray, guideDotDistance, stereogram } from './stereogram';
import { DEFAULT_LETTER, layoutLetter } from './handwritten-letter';

const enc = (s: string) => new TextEncoder().encode(s);

/** A JPEG with EXIF (model, two dates) and XMP. */
function jpegWithDates(): Uint8Array {
  const tiff: number[] = [];
  const w16 = (v: number) => tiff.push(v & 255, v >> 8);
  const w32 = (v: number) => tiff.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24);
  // Header, IFD0 at 8 with 3 entries, ExifIFD after it with 1 entry, then strings.
  tiff.push(0x49, 0x49);
  w16(42);
  w32(8);
  const entry = (tag: number, type: number, count: number, value: number) => {
    w16(tag);
    w16(type);
    w32(count);
    w32(value);
  };
  const ifd0 = 8;
  const exif = ifd0 + 2 + 3 * 12 + 4;
  const data = exif + 2 + 12 + 4;
  const model = 'Kamera X\0';
  const date = '2024:05:01 23:30:00\0';
  w16(3);
  entry(0x0110, 2, model.length, data);
  entry(0x0132, 2, 20, data + model.length);
  entry(0x8769, 4, 1, exif);
  w32(0);
  w16(1);
  entry(0x9003, 2, 20, data + model.length + 20);
  w32(0);
  for (const c of model + date + '2024:05:01 23:30:00\0') tiff.push(c.charCodeAt(0));
  const app1 = [...enc('Exif\0\0'), ...tiff];
  const xmp = enc(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmp:CreateDate="2024-05-01T23:30:00+02:00"/>',
  );
  const seg = (m: number, body: Uint8Array | number[]) => [
    0xff,
    m,
    (body.length + 2) >> 8,
    (body.length + 2) & 255,
    ...body,
  ];
  return new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xe1, app1),
    ...seg(0xe1, xmp),
    0xff,
    0xda,
    0,
    2,
    0xff,
    0xd9,
  ]);
}

const box = (type: string, ...parts: Uint8Array[]) => {
  const len = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(enc(type), 4);
  let p = 8;
  for (const x of parts) {
    out.set(x, p);
    p += x.length;
  }
  return out;
};
const u32 = (...v: number[]) => {
  const o = new Uint8Array(v.length * 4);
  v.forEach((n, i) => new DataView(o.buffer).setUint32(i * 4, n));
  return o;
};

describe('camera clock', () => {
  it('shifts EXIF and XMP dates, also over midnight, keeping the length', async () => {
    const jpg = jpegWithDates();
    const d = await findMediaDates(bytesReader(jpg));
    expect(d.kind).toBe('jpeg');
    expect(d.camera).toBe('Kamera X');
    expect(d.taken?.toISOString()).toBe('2024-05-01T23:30:00.000Z');
    expect(d.spots).toHaveLength(3);
    const fixed = applyPatches(jpg, datePatches(d.spots, 3600 + 120));
    expect(fixed.length).toBe(jpg.length);
    const again = await findMediaDates(bytesReader(fixed));
    expect(again.taken?.toISOString()).toBe('2024-05-02T00:32:00.000Z');
    expect(new TextDecoder().decode(fixed)).toContain('xmp:CreateDate="2024-05-02T00:32:00+02:00"');
  });

  it('shifts MP4 box times and text dates', async () => {
    const created = 3_800_000_000; // seconds since 1904
    const mvhd = box('mvhd', u32(0, created, created, 1000, 5000));
    const day = box('udta', box('©day', enc('2024-05-01T12:00:00+0200')));
    const mp4 = new Uint8Array([
      ...box('ftyp', enc('isom')),
      ...box('moov', mvhd, day),
      ...box('mdat', new Uint8Array(10)),
    ]);
    const d = await findMediaDates(bytesReader(mp4));
    expect(d.kind).toBe('mp4');
    expect(d.spots.filter((s) => s.kind === 'mp4')).toHaveLength(2);
    const fixed = applyPatches(mp4, datePatches(d.spots, -86400));
    const again = await findMediaDates(bytesReader(fixed));
    const box0 = again.spots.find((s) => s.kind === 'mp4');
    expect(box0?.kind === 'mp4' && box0.value).toBe(created - 86400);
    expect(new TextDecoder().decode(fixed)).toContain('2024-04-30T12:00:00+0200');
  });

  it('keeps fractions and time zones of ISO dates', () => {
    expect(shiftDateText('2024-12-31T23:59:59.123Z', 2)).toBe('2025-01-01T00:00:01.123Z');
    expect(shiftDateText('2024:02:28 12:00:00', 86400)).toBe('2024:02:29 12:00:00');
  });
});

describe('email check', () => {
  const phishing = [
    'Received: from mx.example.net by inbox.example.org; Mon, 6 May 2024 10:00:05 +0000',
    'Received: from evil-host.ru (unknown [203.0.113.9]) by mx.example.net; Mon, 6 May 2024 10:00:01 +0000',
    'Authentication-Results: inbox.example.org; spf=fail smtp.mailfrom=evil-host.ru; dkim=none; dmarc=fail header.from=bank.de',
    'From: "Sicherheit service@bank.de" <alerts@evil-host.ru>',
    'Reply-To: helpdesk@other-mail.com',
    'Subject: =?utf-8?B?RHJpbmdlbmQ6IEtvbnRvIGdlc3BlcnJ0?=',
    'Date: Mon, 6 May 2024 10:00:00 +0000',
    'Message-ID: <123@evil-host.ru>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="XX"',
    '',
    '--XX',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p>Ihr Konto wurde gesperrt. Bitte sofort best=C3=A4tigen:</p>',
    '<a href=3D"http://xn--bnk-sna.de/login">https://www.bank.de/login</a>',
    '<a href=3D"https://bit.ly/abc">hier</a>',
    '--XX',
    'Content-Type: application/octet-stream; name="Rechnung.pdf.exe"',
    'Content-Disposition: attachment; filename="Rechnung.pdf.exe"',
    'Content-Transfer-Encoding: base64',
    '',
    'TVqQAAMAAAAEAAAA',
    '--XX--',
    '',
  ].join('\r\n');

  it('takes a phishing mail apart and names what is wrong', () => {
    const r = checkEmail(emlText(enc(phishing)));
    expect(r.subject).toBe('Dringend: Konto gesperrt');
    expect(r.from?.address).toBe('alerts@evil-host.ru');
    expect(r.hops.map((h) => h.by)).toEqual(['mx.example.net', 'inbox.example.org']);
    expect(r.hops[1]?.delay).toBe(4);
    expect(r.auth).toMatchObject({ spf: 'fail', dkim: 'none', dmarc: 'fail' });
    expect(r.attachments[0]).toMatchObject({ name: 'Rechnung.pdf.exe', size: 12 });
    expect(r.text).toContain('bestätigen');
    const keys = r.warnings.map((w) => w.key);
    for (const k of [
      'dmarcFail',
      'spfFail',
      'displayNameAddress',
      'replyToOther',
      'linkMismatch',
      'punycodeLink',
      'shortLink',
      'dangerousAttachment',
      'pressureWords',
    ])
      expect(keys).toContain(k);
    expect(r.verdict).toBe('danger');
  });

  it('a plain, verified mail is fine', () => {
    const ok = [
      'Authentication-Results: mx.example.org; spf=pass; dkim=pass header.d=shop.example.com; dmarc=pass',
      'From: Shop <news@mail.shop.example.com>',
      'Message-ID: <a1@shop.example.com>',
      'Subject: Ihre Bestellung',
      'Content-Type: text/plain; charset=iso-8859-1',
      'Content-Transfer-Encoding: 8bit',
      '',
      'Danke f\xfcr Ihre Bestellung: https://shop.example.com/order/1',
    ].join('\n');
    const r = checkEmail(ok);
    expect(r.text).toContain('Danke für');
    expect(r.links[0]?.domain).toBe('shop.example.com');
    expect(r.verdict).toBe('ok');
    expect(baseDomain('a.b.example.co.uk')).toBe('example.co.uk');
  });
});

describe('sound poster', () => {
  it('turns loudness into bars and escapes the texts', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) samples[i] = i < 500 ? 0.1 : 1;
    const peaks = posterPeaks(samples, 10);
    expect(peaks[9]).toBeCloseTo(1);
    expect(peaks[0]).toBeLessThan(0.5);
    const svg = soundPosterSvg(peaks, {
      style: 'bars',
      format: 'a4',
      background: '#fff',
      wave: '#123',
      text: '#000',
      font: 'serif',
      title: 'Mia <3',
      subtitle: '',
      qr: { count: 3, dark: (x, y) => x === y },
    });
    expect(svg).toContain('width="210mm"');
    expect(svg.match(/<rect x=/g)?.length).toBe(11);
    expect(svg).toContain('Mia &lt;3');
    expect(svg).toContain('<path d="M');
  });
});

describe('magic eye', () => {
  it('flat depth repeats with the background distance; a near shape repeats closer', () => {
    const w = 200;
    const h = 4;
    const E = 60;
    const flat = stereogram(new Float32Array(w * h), w, h, {
      eyeSep: E,
      depth: 0.33,
      pattern: 'mono',
    });
    const d = guideDotDistance(E);
    for (let x = 0; x + d < w; x++) expect(flat[x * 4]).toBe(flat[(x + d) * 4]);
    const near = new Float32Array(w * h).fill(1);
    const img = stereogram(near, w, h, { eyeSep: E, depth: 0.33, pattern: 'color' });
    const s = Math.round(((1 - 0.33) * E) / (2 - 0.33));
    expect(s).toBeLessThan(d);
    for (let x = 0; x + s < w; x++) expect(img[x * 4 + 1]).toBe(img[(x + s) * 4 + 1]);
    expect(depthFromGray(new Uint8Array([255, 255, 255, 255]), 2, 2, false)[0]).toBeCloseTo(1);
  });
});

describe('handwritten letter', () => {
  const adv = (c: string) => (c === ' ' ? 0.3 : 0.5);
  it('wraps at the margin, keeps empty lines and starts new pages', () => {
    const o = { ...DEFAULT_LETTER, wobble: 0 };
    const width = o.pageW - o.margin.left - o.margin.right;
    const pages = layoutLetter('Hallo Welt '.repeat(200) + '\n\nEnde', adv, o);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages)
      for (const g of p)
        expect(g.x + adv(g.ch) * g.size).toBeLessThanOrEqual(o.margin.left + width + 0.6);
    const last = pages.at(-1) ?? [];
    const ende = last.filter((g) => 'Ende'.includes(g.ch)).at(-1);
    const before = last[last.length - 5];
    expect((ende?.y ?? 0) - (before?.y ?? 0)).toBeCloseTo(o.lineHeight * 2);
  });
  it('wobble moves letters a little, the same seed gives the same letter', () => {
    const a = layoutLetter('Liebe Oma', adv, { ...DEFAULT_LETTER, wobble: 1, seed: 5 });
    const b = layoutLetter('Liebe Oma', adv, { ...DEFAULT_LETTER, wobble: 1, seed: 5 });
    expect(a).toEqual(b);
    expect(a[0]?.some((g) => g.rotate !== 0)).toBe(true);
    expect(Math.max(...(a[0] ?? []).map((g) => Math.abs(g.rotate)))).toBeLessThanOrEqual(3);
  });
});

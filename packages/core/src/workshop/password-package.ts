/**
 * Password package: files (and a message) locked into one single HTML file.
 * The receiver opens it in any browser, types the password and gets the
 * files – no program, no upload, nothing leaves their computer.
 * Encryption: AES-256-GCM, key from the password via PBKDF2-SHA-256.
 */

export interface PackageFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface PackageContent {
  message: string;
  files: PackageFile[];
}

/** Texts on the package page (in the language the sender chose). */
export interface PackageTexts {
  lang: string;
  heading: string;
  intro: string;
  hintLabel: string;
  password: string;
  open: string;
  opening: string;
  wrong: string;
  noCrypto: string;
  message: string;
  files: string;
  save: string;
  saveAll: string;
  footer: string;
}

/** PBKDF2 rounds: makes guessing passwords slow (OWASP recommendation for SHA-256). */
export const PACKAGE_ITERATIONS = 600_000;
/** Bigger packages get slow to open in a browser (the whole file is in memory). */
export const PACKAGE_WARN_BYTES = 100 * 1024 * 1024;
export const PACKAGE_MAX_BYTES = 500 * 1024 * 1024;

const MAGIC = 'CBPK1';

/** Files + message as one block of bytes: magic, header length, JSON header, the files. */
export function packPackage(content: PackageContent): Uint8Array {
  const head = new TextEncoder().encode(
    JSON.stringify({
      message: content.message,
      files: content.files.map((f) => ({ name: f.name, type: f.type, size: f.bytes.length })),
    }),
  );
  const total = 9 + head.length + content.files.reduce((s, f) => s + f.bytes.length, 0);
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(5, head.length, true);
  out.set(head, 9);
  let p = 9 + head.length;
  for (const f of content.files) {
    out.set(f.bytes, p);
    p += f.bytes.length;
  }
  return out;
}

export function unpackPackage(bytes: Uint8Array): PackageContent {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== MAGIC) throw new Error('not a package');
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(5, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + len))) as {
    message: string;
    files: { name: string; type: string; size: number }[];
  };
  let p = 9 + len;
  return {
    message: head.message,
    files: head.files.map((f) => {
      const b = bytes.slice(p, p + f.size);
      p += f.size;
      return { name: f.name, type: f.type, bytes: b };
    }),
  };
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  use: 'encrypt' | 'decrypt',
) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [use],
  );
}

export interface SealedPackage {
  data: string;
  salt: string;
  iv: string;
  iterations: number;
}

export async function sealContent(
  content: PackageContent,
  password: string,
  iterations = PACKAGE_ITERATIONS,
): Promise<SealedPackage> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations, 'encrypt');
  const plain = packPackage(content);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as Uint8Array<ArrayBuffer>),
  );
  return { data: toBase64(cipher), salt: toBase64(salt), iv: toBase64(iv), iterations };
}

/**
 * The opening code inside the package page. Plain JavaScript (no modules),
 * also run by the tests – so the page and Conbert can't drift apart.
 */
export const PACKAGE_OPEN_JS = `async function cbOpen(data, salt, iv, iterations, password) {
  var b = function (s) { var t = atob(s), u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(salt), iterations: iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  var plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(iv) }, key, b(data)));
  if (new TextDecoder().decode(plain.subarray(0, 5)) !== 'CBPK1') throw new Error('not a package');
  var len = new DataView(plain.buffer).getUint32(5, true);
  var head = JSON.parse(new TextDecoder().decode(plain.subarray(9, 9 + len)));
  var p = 9 + len;
  return { message: head.message, files: head.files.map(function (f) { var x = plain.subarray(p, p + f.size); p += f.size; return { name: f.name, type: f.type, bytes: x }; }) };
}`;

/** Safe inside HTML text and attributes. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Safe inside a <script type="application/json"> block. */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** The whole package page. Title and hint are readable without the password. */
export function packageHtml(
  sealed: SealedPackage,
  texts: PackageTexts,
  title: string,
  hint: string,
): string {
  const css = `:root{color-scheme:light dark;--bg:#f6f5fb;--card:#fff;--fg:#1d1b26;--muted:#6b6880;--accent:#6d4ae0;--line:#e3e0ee;--bad:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#14121b;--card:#1e1b29;--fg:#ece9f6;--muted:#a19cb8;--accent:#a58cff;--line:#2f2b3d;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:100%;max-width:520px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{font-size:1.4rem;margin:0 0 4px}.lock{font-size:2.4rem}p{margin:.5rem 0}.muted{color:var(--muted);font-size:.9rem}
label{display:block;font-weight:600;margin:16px 0 6px}input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
button,a.btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:600;border:0;border-radius:10px;padding:10px 16px;margin-top:12px;background:var(--accent);color:#fff;cursor:pointer;text-decoration:none}
button.ghost,a.ghost{background:transparent;color:var(--accent);border:1px solid var(--line);padding:6px 12px;margin:0}
.err{color:var(--bad);font-weight:600}.hint{border-left:3px solid var(--accent);padding:4px 10px}
ul{list-style:none;padding:0;margin:8px 0}li{display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:1px solid var(--line);padding:10px 0}
li span{overflow-wrap:anywhere}li img{max-width:64px;max-height:64px;border-radius:6px}.msg{white-space:pre-wrap;background:var(--bg);border-radius:10px;padding:12px}
footer{margin-top:20px}`;
  const script = `${PACKAGE_OPEN_JS}
(function () {
  var T = JSON.parse(document.getElementById('cb-texts').textContent);
  var P = JSON.parse(document.getElementById('cb-params').textContent);
  var form = document.getElementById('cb-form'), out = document.getElementById('cb-out'), err = document.getElementById('cb-err'), btn = document.getElementById('cb-open');
  if (!window.crypto || !crypto.subtle) { err.textContent = T.noCrypto; btn.disabled = true; return; }
  function size(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = T.opening;
    try {
      var data = document.getElementById('cb-data').textContent.trim();
      var c = await cbOpen(data, P.salt, P.iv, P.iterations, document.getElementById('cb-pw').value);
      form.hidden = true;
      if (c.message) { out.appendChild(el('h2', T.message)); out.appendChild(el('p', c.message, 'msg')); }
      out.appendChild(el('h2', T.files));
      var list = el('ul'), links = [];
      c.files.forEach(function (f) {
        var url = URL.createObjectURL(new Blob([f.bytes], { type: f.type || 'application/octet-stream' }));
        var li = el('li'), left = el('span');
        if (/^image\\/(png|jpeg|gif|webp|avif|bmp)$/.test(f.type)) { var img = el('img'); img.src = url; img.alt = ''; li.appendChild(img); }
        left.appendChild(el('strong', f.name)); left.appendChild(el('span', ' · ' + size(f.bytes.length), 'muted'));
        var a = el('a', T.save, 'btn ghost'); a.href = url; a.download = f.name; links.push(a);
        li.appendChild(left); li.appendChild(a); list.appendChild(li);
      });
      out.appendChild(list);
      if (links.length > 1) { var all = el('button', T.saveAll); all.type = 'button'; all.onclick = function () { links.forEach(function (a, i) { setTimeout(function () { a.click(); }, i * 400); }); }; out.appendChild(all); }
    } catch (e) {
      err.textContent = T.wrong;
      btn.disabled = false;
      btn.textContent = T.open;
    }
  });
})();`;
  return `<!doctype html>
<html lang="${esc(texts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:">
<meta name="robots" content="noindex">
<title>${esc(title || texts.heading)}</title>
<style>${css}</style>
</head>
<body>
<main>
<div class="lock" aria-hidden="true">🔒</div>
<h1>${esc(title || texts.heading)}</h1>
<p class="muted">${esc(texts.intro)}</p>
${hint ? `<p class="hint"><strong>${esc(texts.hintLabel)}</strong> ${esc(hint)}</p>` : ''}
<form id="cb-form">
<label for="cb-pw">${esc(texts.password)}</label>
<input id="cb-pw" type="password" autocomplete="off" required autofocus>
<button id="cb-open" type="submit">${esc(texts.open)}</button>
<p id="cb-err" class="err" role="alert"></p>
</form>
<div id="cb-out" aria-live="polite"></div>
<footer class="muted">${esc(texts.footer)}</footer>
</main>
<script type="application/json" id="cb-texts">${json(texts)}</script>
<script type="application/json" id="cb-params">${json({ salt: sealed.salt, iv: sealed.iv, iterations: sealed.iterations })}</script>
<script type="application/octet-stream" id="cb-data">${sealed.data}</script>
<script>${script}</script>
</body>
</html>
`;
}

/** Reads a package page back (Conbert can open its own packages too). */
export async function openPackageHtml(html: string, password: string): Promise<PackageContent> {
  const pick = (id: string) =>
    new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html)?.[1]?.trim();
  const params = pick('cb-params');
  const data = pick('cb-data');
  if (!params || !data) throw new Error('not a package');
  const p = JSON.parse(params) as { salt: string; iv: string; iterations: number };
  const key = await deriveKey(password, fromBase64(p.salt), p.iterations, 'decrypt');
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(p.iv) }, key, fromBase64(data)),
  );
  return unpackPackage(plain);
}

/** Is this an HTML file made by the password package? */
export function isPackageHtml(text: string): boolean {
  return text.includes('id="cb-params"') && text.includes('id="cb-data"');
}

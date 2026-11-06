import DOMPurify from 'dompurify';

/**
 * SVG is shown via <img>, which never runs scripts or loads anything from
 * the network. SVG and HTML from files can contain scripts, event handlers or links to
 * other servers. Everything is cleaned with DOMPurify before it is shown,
 * and HTML additionally runs in a sandboxed iframe without scripts.
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

/** Allows only inline styles and embedded images, nothing from the network. */
const CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";

export function sanitizeHtmlDocument(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['link', 'meta', 'base', 'form'],
  });
  const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;line-height:1.5;margin:1.5rem;color:#1a1a1a;background:#fff}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem}pre{white-space:pre-wrap}</style>`;
  return clean.includes('<head>') ? clean.replace('<head>', `<head>${head}`) : head + clean;
}

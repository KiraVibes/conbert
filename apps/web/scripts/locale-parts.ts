import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Text areas that are only needed on one page and are loaded with it. The
 * workshop alone is over 40 % of all texts; everything else is the start part.
 */
export const LAZY_TEXT_PARTS = ['workshop'] as const;
export type LazyTextPart = (typeof LAZY_TEXT_PARTS)[number];

const PREFIX = 'virtual:conbert-locale/';

/** Splits a locale tree into the start part or one lazy part. */
export function localePart(all: Record<string, unknown>, part: string): Record<string, unknown> {
  if (part === 'start') {
    const rest = { ...all };
    for (const lazy of LAZY_TEXT_PARTS) Reflect.deleteProperty(rest, lazy);
    return rest;
  }
  if (!(LAZY_TEXT_PARTS as readonly string[]).includes(part)) throw new Error(`unknown text part ${part}`);
  return { [part]: all[part] };
}

/**
 * Serves `virtual:conbert-locale/<lang>/<part>` from packages/i18n's JSON files,
 * so the source stays one file per language while the browser loads it in parts.
 */
export function localeParts(): Plugin {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve('@conbert/i18n/locales/de.json'));
  return {
    name: 'conbert-locale-parts',
    resolveId(id) {
      return id.startsWith(PREFIX) ? `\0${id}` : undefined;
    },
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return undefined;
      const match = /^([a-z]{2})\/([a-z]+)$/.exec(id.slice(PREFIX.length + 1));
      if (!match?.[1] || !match[2]) throw new Error(`bad locale module ${id}`);
      const file = path.join(dir, `${match[1]}.json`);
      this.addWatchFile(file);
      const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      // JSON.parse of a string literal is faster for the browser than a big object literal.
      const json = JSON.stringify(localePart(all, match[2]));
      return `export default JSON.parse(${JSON.stringify(json)});`;
    },
  };
}

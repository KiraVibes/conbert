import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resources } from '@conbert/i18n';
import { LAZY_TEXT_PARTS, localePart } from '../../scripts/locale-parts';

const SRC = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('locale parts', () => {
  it('start part plus the lazy parts give back the whole file', () => {
    const all = resources.de.translation;
    const start = localePart(all, 'start');
    const merged = Object.assign(
      { ...start },
      ...LAZY_TEXT_PARTS.map((part) => localePart(all, part)),
    ) as typeof all;
    expect(merged).toEqual(all);
    for (const part of LAZY_TEXT_PARTS) expect(start).not.toHaveProperty(part);
  });

  it('rejects unknown parts', () => {
    expect(() => localePart({}, 'nope')).toThrow();
  });

  // Lazy texts only exist once their page has loaded them: no other page may use them.
  it.each(LAZY_TEXT_PARTS)('"%s" texts are only used on their own page', (part) => {
    const own = path.join(SRC, 'features', part) + path.sep;
    const uses = new RegExp(`['"\`]${part}\\.`);
    const outside = sources(SRC)
      .filter((file) => !file.startsWith(own) && !file.includes(`${path.sep}workers${path.sep}`))
      .filter((file) => uses.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));
    expect(outside).toEqual([]);
  });
});

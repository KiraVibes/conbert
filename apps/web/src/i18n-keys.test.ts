import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMissingKeys } from '@conbert/i18n';
import { FEATURES } from '@conbert/schemas';

/**
 * Help-text guard for the UI: every literal key passed to t('…') or
 * i18nKey="…" in the web sources must exist in German and English.
 * Dynamic keys (template strings) are covered by dedicated tests next to
 * the code that builds them.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'test' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const KEY_PATTERNS = [
  /\bt\(\s*'([a-zA-Z0-9_.]+)'/g, // t('a.b')
  /\b(?!messageKey)\w*Key="([a-zA-Z0-9_.]+)"/g, // helpKey="a.b" (JSX props)
  /\b(?!messageKey)\w*Key:\s*'([a-zA-Z0-9_.]+)'/g, // { helpKey: 'a.b' } (objects)
];

/** Three-part error keys: messageKey="x", { messageKey: 'x' }, new ConversionError('x'). */
const ERROR_PATTERNS = [
  /\bmessageKey[=:]\s*["']([a-zA-Z0-9_.]+)["']/g,
  /ConversionError\(\s*'([a-zA-Z0-9_.]+)'/g,
];

describe('UI texts', () => {
  it('every literal translation key used in the web app exists in de and en', () => {
    const srcDir = path.resolve(import.meta.dirname);
    const used = new Map<string, string>();
    for (const file of sourceFiles(srcDir)) {
      const code = readFileSync(file, 'utf8');
      for (const pattern of KEY_PATTERNS) {
        for (const match of code.matchAll(pattern)) {
          const key = match[1];
          if (key) used.set(key, path.relative(srcDir, file));
        }
      }
    }
    for (const file of sourceFiles(srcDir)) {
      const code = readFileSync(file, 'utf8');
      for (const pattern of ERROR_PATTERNS) {
        for (const match of code.matchAll(pattern)) {
          const key = match[1];
          if (!key) continue;
          for (const part of ['what', 'cause', 'action']) {
            used.set(`${key}.${part}`, path.relative(srcDir, file));
          }
        }
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = findMissingKeys(used.keys()).map(
      (m) => `${m.language}: ${m.key} (used in ${used.get(m.key)})`,
    );
    expect(missing).toEqual([]);
  });

  it('mode and theme texts exist for every value', () => {
    const keys = [
      ...['local', 'server', 'auto'].flatMap((m) => [`mode.${m}.label`, `mode.${m}.help`]),
      ...['system', 'light', 'dark'].map((th) => `settings.theme.${th}`),
    ];
    expect(findMissingKeys(keys)).toEqual([]);
  });

  it('server status texts exist for every state', () => {
    const keys = ['checking', 'online', 'offline', 'degraded'].flatMap((s) => [
      `server.${s}`,
      `server.${s}Help`,
    ]);
    expect(findMissingKeys(keys)).toEqual([]);
  });

  it('every function a group can allow has a name and a help text', () => {
    const keys = [
      ...FEATURES.flatMap((f) => [`permissions.${f}.name`, `permissions.${f}.help`]),
      ...['manual', 'ldap', 'proxy'].map((s) => `groups.memberSource.${s}`),
      ...['group', 'allow', 'deny'].map((c) => `auth.users.choice.${c}`),
      'groups.memberCount_one',
      'groups.memberCount_other',
    ];
    expect(findMissingKeys(keys)).toEqual([]);
  });
});

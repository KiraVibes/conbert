import { describe, expect, it } from 'vitest';
import { findMissingKeys } from '@conbert/i18n';

describe('vault texts', () => {
  it('explains every way opening a file can fail', () => {
    const keys = ['wrong-password', 'wrong-key', 'not-age'].map((c) => `vault.tool.errors.${c}`);
    expect(findMissingKeys(keys)).toEqual([]);
  });
});

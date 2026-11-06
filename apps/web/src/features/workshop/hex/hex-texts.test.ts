import { describe, expect, it } from 'vitest';
import { findMissingKeys } from '@conbert/i18n';

describe('hex viewer texts', () => {
  it('has a text for every reading of the data inspector', () => {
    const keys = [
      'uint8',
      'int8',
      'uint16le',
      'uint16be',
      'uint32le',
      'uint32be',
      'int32le',
      'uint64le',
      'float32le',
      'float64le',
      'unixTime',
      'utf8',
    ].map((k) => `workshop.hex.inspector.${k}`);
    expect(findMissingKeys(keys)).toEqual([]);
  });
});

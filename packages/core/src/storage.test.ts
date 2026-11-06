import { describe, expect, it } from 'vitest';
import {
  STORAGE_FIELDS,
  STORAGE_TYPES,
  StoragePathError,
  expandSubfolderPattern,
  normalizeBasePath,
  normalizeRelativePath,
  numberedName,
  parseSmbAddress,
  safeName,
  secretFields,
} from './storage';

describe('storage paths', () => {
  it('keeps browser paths inside the base folder', () => {
    expect(normalizeRelativePath('')).toBe('');
    expect(normalizeRelativePath('/Fotos//2024/./Urlaub/')).toBe('Fotos/2024/Urlaub');
    expect(normalizeRelativePath('Fotos\\2024')).toBe('Fotos/2024');
    for (const bad of ['..', 'a/../../b', 'Fotos/../..', 'a\u0000b', 'a\nb']) {
      expect(() => normalizeRelativePath(bad), bad).toThrow(StoragePathError);
    }
  });

  it('allows absolute base folders but no way up', () => {
    expect(normalizeBasePath('/volume1/photos/')).toBe('/volume1/photos');
    expect(normalizeBasePath('photos')).toBe('photos');
    expect(normalizeBasePath('')).toBe('');
    expect(() => normalizeBasePath('/volume1/../etc')).toThrow(StoragePathError);
  });

  it('understands copied network-folder addresses', () => {
    expect(parseSmbAddress('\\\\192.168.1.10\\Fotos\\2024')).toEqual({
      host: '192.168.1.10',
      share: 'Fotos',
      path: '2024',
    });
    expect(parseSmbAddress('smb://nas.local/Fotos')).toEqual({
      host: 'nas.local',
      share: 'Fotos',
      path: '',
    });
    expect(parseSmbAddress('nas.local')).toBeNull();
    expect(parseSmbAddress('evil host/share')).toBeNull();
    expect(parseSmbAddress('nas/share/../..')).toBeNull();
  });
});

describe('names and folders', () => {
  it('makes names safe everywhere', () => {
    expect(safeName('a/b:c*?.png')).toBe('a_b_c__.png');
    expect(safeName('..')).toBe('_');
    expect(safeName(' .hidden ')).toBe('hidden');
  });

  it('fills folder patterns', () => {
    const date = new Date(2026, 9, 27);
    expect(expandSubfolderPattern('{date}/{category}', { date, category: 'image' })).toBe(
      '2026-10-27/image',
    );
    expect(expandSubfolderPattern('{year}/{month}/{nope}', { date })).toBe('2026/10/_');
    expect(expandSubfolderPattern('../{ext}/./x:y', { date, ext: 'png' })).toBe('png/x_y');
  });

  it('numbers copies before the extension', () => {
    expect(numberedName('Bild.png', 2)).toBe('Bild (2).png');
    expect(numberedName('README', 3)).toBe('README (3)');
    expect(numberedName('.env', 2)).toBe('.env (2)');
  });
});

describe('storage fields', () => {
  it('marks passwords and keys as secrets', () => {
    expect(secretFields('sftp')).toEqual(['password', 'privateKey']);
    expect(secretFields('s3')).toEqual(['secretAccessKey']);
    expect(secretFields('local')).toEqual([]);
  });

  it('has fields for every supported type', () => {
    for (const type of STORAGE_TYPES) expect(STORAGE_FIELDS[type].length).toBeGreaterThan(0);
  });
});

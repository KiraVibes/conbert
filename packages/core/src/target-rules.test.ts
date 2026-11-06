import { describe, expect, it } from 'vitest';
import { listTargets, type RoutableEngine } from './router';
import { isSensibleTarget } from './target-rules';

describe('isSensibleTarget', () => {
  it.each([
    ['png', 'webp'],
    ['png', 'svg'],
    ['gif', 'mp4'],
    ['mp4', 'gif'],
    ['mp4', 'mp3'],
    ['mid', 'mp3'],
    ['sf2', 'dls'],
    ['docx', 'epub'],
    ['docx', 'png'],
    ['epub', 'md'],
  ])('allows %s → %s', (from, to) => {
    expect(isSensibleTarget(from, to)).toBe(true);
  });

  it.each([
    ['png', 'mp3'],
    ['png', 'mp4'],
    ['gif', 'mp3'],
    ['mp3', 'mp4'],
    ['mp3', 'gif'],
    ['mp4', 'png'],
    ['mid', 'mp4'],
    ['mp3', 'sf2'],
    ['sf2', 'wav'],
    ['docx', 'mp3'],
  ])('rejects %s → %s', (from, to) => {
    expect(isSensibleTarget(from, to)).toBe(false);
  });

  it('allows formats it does not know', () => {
    expect(isSensibleTarget('xyz', 'abc')).toBe(true);
  });
});

describe('listTargets with the rule', () => {
  const image: RoutableEngine = {
    id: 'img',
    runtime: 'browser',
    priority: 10,
    status: 'ready',
    formats: ['png', 'gif'].map((ext) => ({ ext, canRead: true, canWrite: true })),
  };
  const media: RoutableEngine = {
    id: 'media',
    runtime: 'browser',
    priority: 5,
    status: 'ready',
    formats: [
      { ext: 'gif', canRead: true, canWrite: true },
      { ext: 'mp4', canRead: true, canWrite: true },
      { ext: 'mp3', canRead: true, canWrite: true },
    ],
  };

  it('drops chains that end in a different kind of file', () => {
    const fromPng = listTargets([image, media], 'png', ['browser']).map((t) => t.ext);
    expect(fromPng).toEqual(['gif']);
    const fromGif = listTargets([image, media], 'gif', ['browser']).map((t) => t.ext);
    expect(fromGif.sort()).toEqual(['mp4', 'png']);
  });
});

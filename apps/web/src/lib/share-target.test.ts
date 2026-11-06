import { describe, expect, it } from 'vitest';
import { linkFromShare } from './share-target';

describe('share target', () => {
  it.each([
    ['url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc', 'https://www.youtube.com/watch?v=abc'],
    // Instagram puts the link into the text, after some words.
    [
      'text=' +
        encodeURIComponent('Schau mal! https://www.instagram.com/reel/XYZ/?igsh=1 (via App)'),
      'https://www.instagram.com/reel/XYZ/?igsh=1',
    ],
    [
      'title=' + encodeURIComponent('Video: https://vm.tiktok.com/ZM123/.'),
      'https://vm.tiktok.com/ZM123/',
    ],
    ['text=no+link+here', null],
  ])('finds the link in %s', (query, link) => {
    expect(linkFromShare(new URLSearchParams(query))).toBe(link);
  });
});

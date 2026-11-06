import { describe, expect, it } from 'vitest';
import {
  favoritePath,
  folderPlatform,
  isFavoritePath,
  isPremiumPath,
  knownItemOf,
  mediaKind,
  normalPath,
  premiumPath,
  sourceFolder,
} from './media';

describe('favourites keep the folder structure', () => {
  it('moves into Favoriten/ and Favoriten/Premium/ and back', () => {
    const p = 'Instagram/KawaiiQueen/a.jpg';
    expect(favoritePath(p)).toBe('Favoriten/Instagram/KawaiiQueen/a.jpg');
    expect(premiumPath(favoritePath(p))).toBe('Favoriten/Premium/Instagram/KawaiiQueen/a.jpg');
    expect(normalPath(premiumPath(p))).toBe(p);
    expect(normalPath(favoritePath(p))).toBe(p);
    expect(favoritePath(favoritePath(p))).toBe(favoritePath(p));
    expect(isFavoritePath('Favoriten/Gelbooru/ear_blowing/x.png')).toBe(true);
    expect(isPremiumPath('Favoriten/Gelbooru/x.png')).toBe(false);
    expect(sourceFolder('Favoriten/Premium/4chan/wg/Cozy/x.jpg', 2)).toBe('4chan/wg');
  });

  it('knows what can be swiped', () => {
    expect(mediaKind('a.JPG')).toBe('image');
    expect(mediaKind('a.gif')).toBe('gif');
    expect(mediaKind('clip.webm')).toBe('video');
    expect(mediaKind('song.mp3')).toBe('other');
    expect(mediaKind('noext')).toBe('other');
  });
});

describe('file names lead back to the downloaded item', () => {
  it('reads yt-dlp ids and booru posts', () => {
    expect(knownItemOf('YouTube/NASA/Moon landing [dQw4w9WgXcQ].mp4')).toEqual({
      tool: 'yt-dlp',
      platform: 'youtube',
      line: 'youtube dQw4w9WgXcQ',
    });
    expect(knownItemOf('Favoriten/SoundCloud/Artist/Song [123456].mp3')).toMatchObject({
      line: 'soundcloud 123456',
    });
    expect(knownItemOf('Gelbooru/ear_blowing/gelbooru_4711_artist.jpg')).toEqual({
      tool: 'booru',
      siteId: 'gelbooru',
      postId: 4711,
    });
    expect(knownItemOf('yande.re/tag/yandere_12.png')).toEqual({
      tool: 'booru',
      siteId: 'yandere',
      postId: 12,
    });
    // gallery-dl names (Instagram, 4chan) aren't read – those count by name and size.
    expect(knownItemOf('Instagram/KawaiiQueen/3141592653.jpg')).toBeNull();
    // A booru-looking name in a foreign folder is not a booru post.
    expect(knownItemOf('Urlaub/gelbooru_1_x.jpg')).toBeNull();
    expect(folderPlatform('Favoriten/Premium/Instagram/a/b.jpg')).toEqual({
      platform: 'instagram',
    });
    expect(folderPlatform('Danbooru/tag/x.jpg')).toEqual({ booruSite: 'danbooru' });
  });
});

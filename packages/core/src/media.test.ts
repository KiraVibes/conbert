import { describe, expect, it } from 'vitest';
import {
  favoritePath,
  folderPlatform,
  inPost,
  isFavoritePath,
  isPremiumPath,
  knownItemOf,
  mediaKind,
  normalPath,
  postOf,
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

describe('files of one post belong together', () => {
  it('finds the post of a file in its own folder, on every platform', () => {
    const own = (path: string) => postOf(path);
    expect(own('Pixiv/x/151308310/151308310_p76.jpg')).toEqual({
      folder: 'Pixiv/x/151308310',
      id: '151308310',
      own: true,
    });
    expect(own('X/nasa/1790000000000000001/1790000000000000001_2.jpg')?.own).toBe(true);
    expect(
      own('Instagram/kq/3012345678901234567/3012345678901234567_3012345678901234999.jpg')?.own,
    ).toBe(true);
    expect(own('Tumblr/blog/712345678901/tumblr_blog_712345678901_02.jpg')?.own).toBe(true);
    expect(own('Reddit/pics/abc123/abc123 02 Sunset.jpg')?.own).toBe(true);
    expect(own('DeviantArt/a/987654321/deviantart_987654321_Title.png')?.own).toBe(true);
  });

  it('finds loose files of a post by their names', () => {
    expect(postOf('Pixiv/x/151308310_p0_master1200.jpg')).toEqual({
      folder: 'Pixiv/x',
      id: '151308310',
      own: false,
    });
    expect(postOf('X/nasa/1790000000000000001_1.jpg')).toMatchObject({ id: '1790000000000000001' });
    expect(postOf('Tumblr/blog/tumblr_blog_712345678901_01.jpg')).toMatchObject({
      id: '712345678901',
    });
    expect(postOf('Reddit/pics/abc123 01 Sunset.jpg')).toMatchObject({ id: 'abc123' });
  });

  it('never takes a tag or artist folder for a post', () => {
    expect(postOf('Gelbooru/sakimichan/gelbooru_4711_sakimichan.png')).toBeNull();
    expect(postOf('Instagram/a/151308310.jpg')).toBeNull();
    expect(postOf('Instagram/a/1_photo.jpg')).toBeNull();
    expect(postOf('YouTube/NASA/Moon [dQw4w9WgXcQ].mp4')).toBeNull();
    expect(postOf('Urlaub/kawaii/kawaii_01.jpg')).toBeNull();
  });

  it('only the same post in the same folder counts', () => {
    const post = { folder: 'Pixiv/x', id: '42' };
    expect(inPost('Pixiv/x/42_p3.png', post)).toBe(true);
    expect(inPost('Pixiv/x/421_p0.png', post)).toBe(false);
    expect(inPost('Pixiv/y/42_p0.png', post)).toBe(false);
  });
});

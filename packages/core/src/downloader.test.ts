import { describe, expect, it } from 'vitest';
import {
  COOKIE_PLATFORMS,
  compactDate,
  detectPlatform,
  downloadSourceName,
  instagramAccount,
  isPrivateHost,
  parseDownloadUrl,
  pixivLink,
  profilePartsFor,
  toolsFor,
} from './downloader';
import { fourChanBoard, platformFolder } from './downloader';
import { downloadFolder } from './storage';

const platform = (url: string) => detectPlatform(new URL(url));

describe('downloader links', () => {
  it('recognises the platforms', () => {
    expect(platform('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(platform('https://youtu.be/abc')).toBe('youtube');
    expect(platform('https://www.instagram.com/natgeo/')).toBe('instagram');
    expect(platform('https://twitter.com/a/status/1')).toBe('x');
    expect(platform('https://x.com/a/status/1')).toBe('x');
    expect(platform('https://old.reddit.com/r/pics')).toBe('reddit');
    expect(platform('https://www.pinterest.de/pin/1')).toBe('pinterest');
    expect(platform('https://boards.4chan.org/diy/thread/3012269')).toBe('4chan');
    expect(platform('https://i.4cdn.org/diy/1792688608031882.jpg')).toBe('4chan');
    expect(toolsFor('4chan')[0]).toBe('gallery-dl');
    expect(COOKIE_PLATFORMS).not.toContain('4chan');
    expect(platform('https://example.com/video.mp4')).toBe('other');
    // Look-alikes are not the real thing.
    expect(platform('https://notyoutube.com/watch')).toBe('other');
  });

  it('accepts only public web links', () => {
    expect(parseDownloadUrl('  https://www.tiktok.com/@a/video/1 ')?.hostname).toBe(
      'www.tiktok.com',
    );
    for (const bad of [
      'ftp://example.com/a',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pw@example.com/',
      'http://localhost:3313/api',
      'http://127.0.0.1/',
      'http://192.168.1.10/share',
      'http://10.0.0.5/',
      'http://172.20.0.2/',
      'http://[::1]/',
      'http://nas/',
      'http://fritz.box.local/',
      'kein link',
      `https://example.com/${'a'.repeat(2100)}`,
    ]) {
      expect(parseDownloadUrl(bad), bad).toBeNull();
    }
    expect(isPrivateHost('8.8.8.8')).toBe(false);
  });

  it('knows private addresses in all their spellings', () => {
    for (const host of [
      '::ffff:127.0.0.1',
      '[::ffff:7f00:1]',
      '::ffff:c0a8:101',
      '64:ff9b::a00:1',
      'fe80::1',
      'ff02::1',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      'localhost.',
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of [
      '::ffff:808:808',
      '2a00:1450:4001::200e',
      '93.184.215.14',
      'example.com.',
    ]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
    // The URL parser writes mapped addresses in hex: still refused.
    expect(parseDownloadUrl('http://[::ffff:127.0.0.1]/')).toBeNull();
  });

  it('picks the tools and parts per platform', () => {
    expect(toolsFor('instagram')).toEqual(['gallery-dl', 'yt-dlp']);
    expect(toolsFor('youtube')).toEqual(['yt-dlp', 'gallery-dl']);
    expect(profilePartsFor('instagram')).toContain('stories');
    expect(profilePartsFor('youtube')).toEqual([]);
  });

  it('formats dates for the tools', () => {
    expect(compactDate('2026-10-27')).toBe('20261027');
    expect(compactDate('27.10.2026')).toBeNull();
  });
});

describe('download folders', () => {
  const base = { title: null, uploader: null, url: 'https://x' };
  it('names the folder after the channel, profile, thread or playlist', () => {
    expect(
      downloadSourceName({
        ...base,
        platform: 'youtube',
        kind: 'profile',
        title: 'NASA - Videos',
        uploader: 'NASA',
      }),
    ).toBe('NASA');
    expect(
      downloadSourceName({
        ...base,
        platform: 'youtube',
        kind: 'playlist',
        title: 'Mondlandung',
        uploader: 'NASA',
      }),
    ).toBe('Mondlandung');
    expect(
      downloadSourceName({
        ...base,
        platform: 'youtube',
        kind: 'single',
        title: 'Clip',
        uploader: 'NASA',
      }),
    ).toBe('NASA');
    expect(
      downloadSourceName({ ...base, platform: 'other', kind: 'single', title: 'clip' }),
    ).toBeNull();
    expect(
      downloadSourceName({ ...base, platform: 'instagram', kind: 'profile', uploader: 'natgeo' }),
    ).toBe('natgeo');
    // A joint post on top of the profile must not rename the folder.
    expect(
      downloadSourceName({
        ...base,
        platform: 'instagram',
        kind: 'profile',
        uploader: 'proxy_unit',
        url: 'https://www.instagram.com/vinne.art',
      }),
    ).toBe('vinne.art');
    expect(instagramAccount('https://www.instagram.com/vinne.art/reels/')).toBe('vinne.art');
    expect(instagramAccount('https://www.instagram.com/stories/vinne.art/')).toBe('vinne.art');
    expect(instagramAccount('https://www.instagram.com/p/AbC123/')).toBeNull();
    expect(
      downloadSourceName({
        ...base,
        platform: '4chan',
        kind: 'playlist',
        title: '  Werkbank\n Thread ',
        uploader: 'Anonymous',
      }),
    ).toBe('Werkbank Thread');
    expect(
      downloadSourceName({
        ...base,
        platform: '4chan',
        kind: 'playlist',
        url: 'https://boards.4chan.org/diy/thread/123',
      }),
    ).toBe('Thread 123');
  });

  it('adds the source folder behind the location’s own pattern', () => {
    const date = new Date(2026, 9, 30);
    expect(downloadFolder('{platform}', { date, platform: 'youtube', source: 'NASA' })).toBe(
      'youtube/NASA',
    );
    expect(downloadFolder('', { date, source: 'A/B: C' })).toBe('A_B_ C');
    expect(downloadFolder('{source}/{year}', { date, source: 'NASA' })).toBe('NASA/2026');
    expect(downloadFolder('{year}', { date })).toBe('2026');
  });

  it('puts every platform into its own top folder', () => {
    const date = new Date(2026, 9, 30);
    const at = (platform: string, url: string, source: string) =>
      downloadFolder('', { date, platformFolder: platformFolder(platform, url), source });
    expect(at('instagram', 'https://www.instagram.com/kawaiiqueen/', 'kawaiiqueen')).toBe(
      'Instagram/kawaiiqueen',
    );
    expect(at('youtube', 'https://www.youtube.com/@NASA', 'NASA')).toBe('YouTube/NASA');
    expect(at('soundcloud', 'https://soundcloud.com/artist', 'Artist')).toBe('SoundCloud/Artist');
    expect(at('4chan', 'https://boards.4chan.org/wg/thread/123', 'Cozy rooms')).toBe(
      '4chan/wg/Cozy rooms',
    );
    expect(at('other', 'https://example.com/a', 'x')).toBe('Web/x');
    expect(at('nonsense', 'https://example.com/a', 'x')).toBe('Web/x');
    expect(fourChanBoard('https://boards.4channel.org/g/thread/1')).toBe('g');
    expect(fourChanBoard('https://example.com/')).toBeNull();
    // The location's own pattern stays in front; {platform} places it itself.
    expect(
      downloadFolder('{year}', { date, platformFolder: 'Instagram', source: 'kawaiiqueen' }),
    ).toBe('2026/Instagram/kawaiiqueen');
    expect(
      downloadFolder('{platform}', {
        date,
        platform: 'instagram',
        platformFolder: 'Instagram',
        source: 'kawaiiqueen',
      }),
    ).toBe('instagram/kawaiiqueen');
  });
});

describe('deviantart', () => {
  it('goes to gallery-dl only and needs no cookies', () => {
    expect(platform('https://www.deviantart.com/someone/favourites')).toBe('deviantart');
    expect(platform('https://someone.deviantart.com/gallery/')).toBe('deviantart');
    expect(platform('https://fav.me/d2abc')).toBe('deviantart');
    expect(platform('https://sta.sh/0abc')).toBe('deviantart');
    expect(platform('https://notdeviantart.com/x')).toBe('other');
    expect(toolsFor('deviantart')).toEqual(['gallery-dl']);
    expect(COOKIE_PLATFORMS).not.toContain('deviantart');
    expect(platformFolder('deviantart', 'https://www.deviantart.com/a')).toBe('DeviantArt');
  });
});

describe('pixiv', () => {
  it('knows Pixiv links and what they point to', () => {
    expect(platform('https://www.pixiv.net/en/artworks/12345')).toBe('pixiv');
    expect(platform('https://pixiv.me/someone')).toBe('pixiv');
    expect(toolsFor('pixiv')).toEqual(['gallery-dl']);
    // Pixiv logs in with its own key, not with cookies.
    expect(COOKIE_PLATFORMS).not.toContain('pixiv');
    expect(pixivLink('https://www.pixiv.net/en/artworks/12345')).toEqual({
      kind: 'single',
      tag: null,
    });
    expect(pixivLink('https://www.pixiv.net/users/11')?.kind).toBe('profile');
    expect(pixivLink('https://www.pixiv.net/en/users/11/illustrations')?.kind).toBe('profile');
    expect(pixivLink('https://www.pixiv.net/users/11/bookmarks/artworks')?.kind).toBe('playlist');
    expect(pixivLink('https://www.pixiv.net/en/tags/%E9%A2%A8%E6%99%AF/artworks')).toEqual({
      kind: 'playlist',
      tag: '風景',
    });
    expect(pixivLink('https://pixiv.me/someone')?.kind).toBe('profile');
    expect(pixivLink('https://www.pixiv.net/novel/show.php?id=1')).toBeNull();
  });

  it('puts Pixiv downloads under the artist or the tag', () => {
    expect(platformFolder('pixiv', 'https://www.pixiv.net/users/11')).toBe('Pixiv');
    expect(
      downloadSourceName({
        platform: 'pixiv',
        kind: 'playlist',
        title: '#風景',
        uploader: 'Someone',
        url: 'https://www.pixiv.net/tags/%E9%A2%A8%E6%99%AF',
      }),
    ).toBe('Tag 風景');
    expect(
      downloadSourceName({
        platform: 'pixiv',
        kind: 'profile',
        title: 'Mika',
        uploader: 'Mika',
        url: 'https://www.pixiv.net/users/11',
      }),
    ).toBe('Mika');
  });
});

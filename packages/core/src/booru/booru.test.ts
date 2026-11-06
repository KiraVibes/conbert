import { describe, expect, it } from 'vitest';
import {
  BOORU_SITES,
  builtinSite,
  retiredSite,
  DEFAULT_BLACKLIST,
  buildQuery,
  checkPostProtection,
  checkQueryProtection,
  estimateScanned,
  insideWindow,
  isBlacklisted,
  isSuggestionAllowed,
  matchesLocal,
  msUntilWindow,
  normalizeRating,
  parseGelbooruCredentials,
  parsePostUrl,
  parseQuery,
  planQuery,
  postPageUrl,
  renderPostName,
  requestInterval,
  type BooruPost,
} from '../index';

function post(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id: 123,
    md5: 'abc123',
    rating: 'general',
    tags: ['1girl', 'blue_eyes', 'cat_ears'],
    artists: ['some_artist'],
    characters: ['hero'],
    copyrights: ['series'],
    score: 42,
    favorites: 10,
    width: 1920,
    height: 1080,
    ext: 'png',
    size: 1000,
    createdAt: '2024-05-01T10:00:00.000Z',
    fileUrl: 'https://cdn.example/file.png',
    sampleUrl: null,
    previewUrl: 'https://cdn.example/preview.jpg',
    source: null,
    postUrl: 'https://danbooru.donmai.us/posts/123',
    ...overrides,
  };
}

describe('mandatory protection – posts', () => {
  it('lets normal posts through', () => {
    expect(checkPostProtection(post()).ok).toBe(true);
    expect(checkPostProtection(post({ rating: 'explicit', tags: ['1girl', 'nude'] })).ok).toBe(
      true,
    );
  });

  it.each([
    ['loli'],
    ['lolicon'],
    ['shota'],
    ['shotacon'],
    ['toddlercon'],
    ['oppai_loli'],
    ['onee-shota'],
    ['loli_(style)'],
    ['cub'],
    ['LOLI'],
    ['ロリ'],
  ])('always blocks "%s", even when rated general', (tag) => {
    expect(checkPostProtection(post({ tags: ['1girl', tag], rating: 'general' })).ok).toBe(false);
  });

  it('does not block similar but harmless words', () => {
    for (const tag of [
      'lolita_fashion',
      'gothic_lolita',
      'shotgun',
      'lollipop',
      'lion_cub_plush',
    ]) {
      expect(checkPostProtection(post({ tags: ['1girl', tag], rating: 'explicit' })).ok, tag).toBe(
        true,
      );
    }
  });

  it('blocks minors unless the post is general and not sexual', () => {
    expect(checkPostProtection(post({ tags: ['child', 'park'], rating: 'general' })).ok).toBe(true);
    for (const rating of ['sensitive', 'questionable', 'explicit', null] as const) {
      expect(
        checkPostProtection(post({ tags: ['child', 'park'], rating })).ok,
        String(rating),
      ).toBe(false);
    }
    expect(checkPostProtection(post({ tags: ['young', 'nude'], rating: 'general' })).ok).toBe(
      false,
    );
    expect(
      checkPostProtection(post({ tags: ['aged_down', 'panties'], rating: 'general' })).ok,
    ).toBe(false);
  });

  it('blocks posts it cannot check (no tags)', () => {
    expect(checkPostProtection(post({ tags: [] })).ok).toBe(false);
    expect(checkPostProtection(post({ tags: ['', ' '] })).ok).toBe(false);
  });
});

describe('mandatory protection – queries', () => {
  it('allows normal searches and exclusions', () => {
    expect(checkQueryProtection(['blue_eyes', 'cat_ears']).ok).toBe(true);
    expect(checkQueryProtection(['1girl', '-loli', '-shota', 'rating:e']).ok).toBe(true);
  });

  it('refuses blocked tags, also inside OR groups and wildcards', () => {
    expect(checkQueryProtection(['loli']).ok).toBe(false);
    expect(checkQueryProtection(['~shota', '~cat']).ok).toBe(false);
    expect(checkQueryProtection(['(loli', 'or', 'cat)']).ok).toBe(false);
    expect(checkQueryProtection(['lol*']).ok).toBe(false);
    expect(checkQueryProtection(['*con']).ok).toBe(false);
    expect(checkQueryProtection(['sho*']).ok).toBe(false);
    expect(checkQueryProtection(['blue*']).ok).toBe(true);
  });

  it('refuses minors combined with sexual tags or wider ratings', () => {
    expect(checkQueryProtection(['child', 'nude']).ok).toBe(false);
    expect(checkQueryProtection(['child', 'rating:e']).ok).toBe(false);
    expect(checkQueryProtection(['child', '-rating:g']).ok).toBe(false);
    expect(checkQueryProtection(['child', 'rating:s'], 'danbooru').ok).toBe(false);
    expect(checkQueryProtection(['young', 'rating:s'], 'e621').ok).toBe(true);
    expect(checkQueryProtection(['child', 'rating:g']).ok).toBe(true);
    expect(checkQueryProtection(['child', 'park']).ok).toBe(true);
  });

  it('never suggests blocked tags', () => {
    expect(isSuggestionAllowed('loli')).toBe(false);
    expect(isSuggestionAllowed('oppai_loli')).toBe(false);
    expect(isSuggestionAllowed('lolita_fashion')).toBe(true);
  });
});

describe('ratings', () => {
  it('maps the site ratings', () => {
    expect(normalizeRating('g', 'danbooru')).toBe('general');
    expect(normalizeRating('s', 'danbooru')).toBe('sensitive');
    expect(normalizeRating('s', 'e621')).toBe('general');
    expect(normalizeRating('s', 'moebooru')).toBe('general');
    expect(normalizeRating('safe', 'gelbooru')).toBe('general');
    expect(normalizeRating('Explicit', 'gelbooru')).toBe('explicit');
    expect(normalizeRating('?', 'gelbooru')).toBeNull();
    expect(normalizeRating(undefined, 'gelbooru')).toBeNull();
  });
});

describe('search syntax ↔ form', () => {
  it('parses tags, exclusions and conditions', () => {
    const form = parseQuery(
      'Blue_Eyes -cat_ears score:>=50 width:>=1920 height:>1080 date:>=2024-01-01 date:<=2024-12-31 order:score type:video pool:12',
    );
    expect(form).toEqual({
      include: ['blue_eyes'],
      exclude: ['cat_ears'],
      minScore: 50,
      minWidth: 1920,
      minHeight: 1080,
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      order: 'score',
      media: 'video',
      extra: ['pool:12'],
    });
  });

  it('understands Gelbooru sort syntax and date ranges', () => {
    expect(parseQuery('sort:score:desc').order).toBe('score');
    expect(parseQuery('date:2024-01-01..2024-02-01')).toMatchObject({
      dateFrom: '2024-01-01',
      dateTo: '2024-02-01',
    });
  });

  it('round-trips form → text → form', () => {
    const text = 'blue_eyes -cat_ears ~a ~b score:>=10 date:>=2024-01-01 type:image order:random';
    const form = parseQuery(text);
    expect(parseQuery(buildQuery(form))).toEqual(form);
    expect(buildQuery(form)).toBe(text);
  });
});

describe('query plan (tag limits and local checks)', () => {
  // The Danbooru and e621 APIs still serve own instances.
  const site = (id: string) => {
    const found = builtinSite(id) ?? retiredSite(id);
    if (!found) throw new Error(id);
    return found;
  };
  const danbooru = site('danbooru');
  const gelbooru = site('gelbooru');
  const e621 = site('e621');

  it('sends the rarest tags first and checks the rest itself', () => {
    const plan = planQuery('common rare medium -bad', {
      site: danbooru,
      tagLimit: 2,
      counts: { common: 100_000, rare: 50, medium: 2_000 },
      ratings: ['general'],
    });
    expect(plan.apiTokens).toEqual(['rare', 'medium', 'rating:g']);
    expect(plan.localOnly).toEqual(['common', '-bad']);
    expect(plan.idNavigation).toBe(true);
    expect(estimateScanned(plan, { rare: 50, medium: 2000 })).toBe(50);
    expect(matchesLocal(post({ tags: ['common', 'rare', 'medium'] }), plan.local)).toBe(true);
    expect(matchesLocal(post({ tags: ['common', 'rare', 'medium', 'bad'] }), plan.local)).toBe(
      false,
    );
    expect(matchesLocal(post({ tags: ['rare', 'medium'] }), plan.local)).toBe(false);
  });

  it('reserves a slot for the ID tag on Gelbooru-like sites', () => {
    const plan = planQuery('a b c', { site: gelbooru, tagLimit: 2, ratings: ['general'] });
    expect(plan.apiTokens).toEqual(['a']);
    expect(plan.localOnly).toEqual(['b', 'c']);
  });

  it('narrows the rating at the site when a slot is free, and always checks it', () => {
    const plan = planQuery('a', { site: e621, tagLimit: 40, ratings: ['general'] });
    expect(plan.apiTokens).toEqual(['a', 'rating:s']);
    expect(matchesLocal(post({ tags: ['a'], rating: 'explicit' }), plan.local)).toBe(false);
    expect(matchesLocal(post({ tags: ['a'], rating: null }), plan.local)).toBe(false);
    const all = planQuery('a', {
      site: danbooru,
      tagLimit: 6,
      ratings: ['general', 'sensitive', 'questionable', 'explicit'],
    });
    expect(all.apiTokens).toEqual(['a']);
  });

  it('translates the order for Gelbooru and gives up ID navigation for other orders', () => {
    const plan = planQuery('a order:score', { site: gelbooru, tagLimit: 20, ratings: ['general'] });
    expect(plan.apiTokens).toContain('sort:score:desc');
    expect(plan.idNavigation).toBe(false);
  });

  it('reports site-only syntax that does not fit', () => {
    const plan = planQuery('pool:1 fav:someone a', {
      site: danbooru,
      tagLimit: 1,
      ratings: ['general'],
    });
    expect(plan.apiTokens).toEqual(['pool:1', 'rating:g']);
    expect(plan.overflow).toEqual(['fav:someone']);
  });

  it('checks dates, sizes, score and file type locally', () => {
    const plan = planQuery('date:>=2024-06-01 width:>=3000 type:video', {
      site: gelbooru,
      tagLimit: 1,
      ratings: ['general'],
    });
    expect(matchesLocal(post(), plan.local)).toBe(false);
    expect(
      matchesLocal(
        post({ createdAt: '2024-07-01T00:00:00Z', width: 4000, ext: 'mp4' }),
        plan.local,
      ),
    ).toBe(true);
  });
});

describe('own blacklist', () => {
  it('hides posts that have all tags of a line', () => {
    const list = ['gore', 'cat_ears blue_eyes', 'spider rating:e', 'dog -cute'];
    expect(isBlacklisted(post({ tags: ['gore'] }), list)).toBe(true);
    expect(isBlacklisted(post({ tags: ['cat_ears'] }), list)).toBe(false);
    expect(isBlacklisted(post({ tags: ['cat_ears', 'blue_eyes'] }), list)).toBe(true);
    expect(isBlacklisted(post({ tags: ['spider'], rating: 'general' }), list)).toBe(false);
    expect(isBlacklisted(post({ tags: ['spider'], rating: 'explicit' }), list)).toBe(true);
    expect(isBlacklisted(post({ tags: ['dog'] }), list)).toBe(true);
    expect(isBlacklisted(post({ tags: ['dog', 'cute'] }), list)).toBe(false);
    expect(isBlacklisted(post({ tags: ['big_spider'] }), ['*spider'])).toBe(true);
  });

  it('starts with suggestions', () => {
    expect(DEFAULT_BLACKLIST.length).toBeGreaterThan(3);
  });
});

describe('file names', () => {
  const ctx = { site: 'danbooru', searchTags: 'blue_eyes cat_ears order:score' };

  it('fills the patterns', () => {
    expect(
      renderPostName('{site}_{id}_{artist}.{ext}', '{site}/{search_tags}', post(), ctx),
    ).toEqual({ folder: 'danbooru/blue_eyes cat_ears', name: 'danbooru_123_some_artist.png' });
    // Folders get the site's name like the platform folders; file names keep the id.
    expect(
      renderPostName('{site}_{id}_{artist}.{ext}', '{site}/{search_tags}', post(), {
        ...ctx,
        siteFolder: 'Danbooru',
      }),
    ).toEqual({ folder: 'Danbooru/blue_eyes cat_ears', name: 'danbooru_123_some_artist.png' });
    expect(renderPostName('{md5}.{ext}', '', post(), ctx)).toEqual({
      folder: '',
      name: 'abc123.png',
    });
  });

  it('tidies up empty values and keeps the extension', () => {
    expect(renderPostName('{site}_{id}_{artist}.{ext}', '', post({ artists: [] }), ctx).name).toBe(
      'danbooru_123.png',
    );
    expect(renderPostName('{artist}', '', post({ artists: [] }), ctx).name).toBe('123.png');
    expect(renderPostName('{id}', '{artist}', post(), ctx)).toEqual({
      folder: 'some_artist',
      name: '123.png',
    });
  });

  it('never leaves the folder', () => {
    const evil = post({ artists: ['../../etc'], characters: ['a/b\\c'] });
    const result = renderPostName('{artist}/{character}_{id}.{ext}', '../{artist}', evil, ctx);
    expect(result.folder.split('/')).not.toContain('..');
    expect(result.name).not.toMatch(/[/\\]/);
    expect(result.folder).not.toMatch(/\\/);
  });
});

describe('sites', () => {
  it('builds post links and reads them back', () => {
    for (const site of BOORU_SITES) {
      const url = postPageUrl(site, 4567);
      expect(parsePostUrl(url, BOORU_SITES), url).toEqual({ siteId: site.id, postId: 4567 });
    }
    expect(parsePostUrl('https://example.com/posts/1', BOORU_SITES)).toBeNull();
    expect(parsePostUrl('https://danbooru.donmai.us/posts?tags=a', BOORU_SITES)).toBeNull();
    expect(parsePostUrl('nonsense', BOORU_SITES)).toBeNull();
  });

  it('splits the pasted Gelbooru access line', () => {
    expect(parseGelbooruCredentials('&api_key=abc123DEF&user_id=98765')).toEqual({
      apiKey: 'abc123DEF',
      userId: '98765',
    });
    expect(parseGelbooruCredentials('abc123DEF')).toBeNull();
  });

  it('never asks faster than the site allows', () => {
    expect(requestInterval('normal', 1000)).toBe(1000);
    expect(requestInterval('slow', 500)).toBe(2000);
    expect(requestInterval('very-slow', 500)).toBe(10000);
    expect(requestInterval('slow', 1000, 100)).toBe(1000);
  });
});

describe('night window', () => {
  const at = (h: number) => new Date(2024, 0, 1, h, 30);
  it('knows when it is open', () => {
    const night = { fromHour: 1, toHour: 7 };
    expect(insideWindow(night, at(3))).toBe(true);
    expect(insideWindow(night, at(8))).toBe(false);
    expect(insideWindow({ fromHour: 22, toHour: 6 }, at(23))).toBe(true);
    expect(insideWindow({ fromHour: 22, toHour: 6 }, at(12))).toBe(false);
    expect(insideWindow(null, at(12))).toBe(true);
    expect(msUntilWindow(night, at(3))).toBe(0);
    expect(msUntilWindow(night, at(8))).toBe((16 * 60 + 30) * 60_000);
  });
});

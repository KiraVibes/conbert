import { normalizeTag, type BooruPost } from './posts';
import type { BooruApi } from './sites';

/**
 * Mandatory protection – cannot be switched off by any setting, account,
 * subscription or workflow: no search for, no thumbnail of and no download
 * of content that sexualises minors. Every query and every single post is
 * checked; when in doubt (no tags, unknown rating) the post is blocked.
 *
 * Three groups of tags:
 * - BLOCKED: tags that by themselves mean sexualised minors → always blocked.
 * - MINOR: tags that show a child or a young character → only with the
 *   rating "general" and without any sexual tag.
 * - SEXUAL: tags with sexual content (used together with MINOR).
 */

/** Words that make any tag containing them blocked ("oppai_loli", "onee-shota"). */
const BLOCKED_WORDS = new Set(['loli', 'lolicon', 'lolis', 'shota', 'shotacon', 'shotas']);
/** Parts that are blocked wherever they appear in a tag. */
const BLOCKED_PARTS = [
  'lolicon',
  'shotacon',
  'toddlercon',
  'pedophil',
  'paedophil',
  'ロリ',
  'ショタ',
];
/** Whole tags that are always blocked. */
const BLOCKED_TAGS = new Set([
  'cub', // e621: young characters in sexual art
  'child_porn',
  'child_pornography',
  'cp',
  'jailbait',
  'pedo',
  'underage_sex',
  'child_sex',
  '児童ポルノ',
]);

/** Tags that show minors – fine only in general-rated posts without sexual tags. */
const MINOR_TAGS = new Set([
  'child',
  'children',
  'kid',
  'kids',
  'toddler',
  'baby',
  'infant',
  'minor',
  'underage',
  'preteen',
  'young', // e621
  'younger',
  'aged_down',
  'little_girl',
  'little_boy',
  'female_child',
  'male_child',
  'mesugaki',
  'randoseru',
  'kindergarten_uniform',
  'kindergartener',
  'elementary_school_student',
  'elementary_schooler',
  'grade_schooler',
  '幼女',
  '子供',
  '児童',
  '小学生',
  '園児',
]);

/** Sexual or nude content. */
const SEXUAL_TAGS = new Set([
  'sex',
  'nude',
  'completely_nude',
  'nipples',
  'areolae',
  'pussy',
  'vulva',
  'penis',
  'genitals',
  'testicles',
  'anus',
  'vaginal',
  'anal',
  'oral',
  'fellatio',
  'cunnilingus',
  'handjob',
  'masturbation',
  'cum',
  'ejaculation',
  'erection',
  'sex_toy',
  'dildo',
  'vibrator',
  'penetration',
  'rape',
  'groping',
  'molestation',
  'bondage',
  'bdsm',
  'topless',
  'bottomless',
  'breasts_out',
  'panties',
  'pantyshot',
  'underwear_only',
  'lingerie',
  'cameltoe',
  'spread_legs',
  'spread_pussy',
  'presenting',
  'suggestive',
  'nsfw',
  'hentai',
  'ecchi',
  'lewd',
]);

/** Separators inside tags: "oppai_loli", "onee-shota", "loli_(style)". */
function words(tag: string): string[] {
  return tag.split(/[_\-\s()[\]{}:,.]+/).filter((w) => w !== '');
}

function isBlockedTag(tag: string): boolean {
  if (BLOCKED_TAGS.has(tag)) return true;
  if (BLOCKED_PARTS.some((part) => tag.includes(part))) return true;
  return words(tag).some((w) => BLOCKED_WORDS.has(w));
}

function isMinorTag(tag: string): boolean {
  return MINOR_TAGS.has(tag) || words(tag).some((w) => MINOR_TAGS.has(w) && w.length > 3);
}

function isSexualTag(tag: string): boolean {
  return SEXUAL_TAGS.has(tag);
}

export type ProtectionVerdict = { ok: true } | { ok: false; reason: 'protected' };

const BLOCKED: ProtectionVerdict = { ok: false, reason: 'protected' };
const OK: ProtectionVerdict = { ok: true };

/** The mandatory check for one post. Runs before any thumbnail or file is fetched. */
export function checkPostProtection(post: Pick<BooruPost, 'tags' | 'rating'>): ProtectionVerdict {
  const tags = post.tags.map(normalizeTag).filter((t) => t !== '');
  // Without tags the post can't be checked.
  if (tags.length === 0) return BLOCKED;
  if (tags.some(isBlockedTag)) return BLOCKED;
  if (tags.some(isMinorTag)) {
    if (post.rating !== 'general') return BLOCKED;
    if (tags.some(isSexualTag)) return BLOCKED;
  }
  return OK;
}

/** Turns a site wildcard pattern ("lol*", "*con") into a check. */
function globMatches(pattern: string, candidates: Iterable<string>): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const regex = new RegExp(`^${source}$`);
  for (const candidate of candidates) if (regex.test(candidate)) return true;
  return false;
}

const BLOCKED_SAMPLES = [
  ...BLOCKED_WORDS,
  ...BLOCKED_TAGS,
  'toddlercon',
  'oppai_loli',
  'onee-shota',
  'loli_(style)',
];

/** Words in a query that stand for "not only general". */
function widensRating(token: string, api: BooruApi | undefined): boolean {
  const m = /^(-?)rating:(.+)$/.exec(token);
  if (!m) return false;
  // "s" is "safe" on e621 and Moebooru, but "sensitive" on Danbooru.
  const safe = ['g', 'general', 'safe', ...(api === 'e621' || api === 'moebooru' ? ['s'] : [])];
  const values = (m[2] ?? '').split(',');
  const general = values.every((v) => safe.includes(v));
  // "rating:g" narrows; "-rating:g" or "rating:e" widens.
  return m[1] === '-' ? general : !general;
}

export interface QueryVerdict {
  ok: boolean;
  /** The tags that made the query refused (for the log, never shown in detail). */
  tokens: string[];
}

/**
 * The mandatory check for a search (tags, wildcards, combinations).
 * Excluding a tag ("-loli") is always fine.
 */
export function checkQueryProtection(tokens: readonly string[], api?: BooruApi): QueryVerdict {
  const positive = tokens
    .map((t) => normalizeTag(t).replace(/^[~({]+|[)}]+$/g, ''))
    .filter((t) => t !== '' && !t.startsWith('-') && t !== 'or' && t !== 'and');
  const refused: string[] = [];
  for (const token of positive) {
    if (isBlockedTag(token)) refused.push(token);
    else if (token.includes('*') && globMatches(token, BLOCKED_SAMPLES)) refused.push(token);
  }
  const all = tokens.map(normalizeTag);
  const minor = positive.filter(isMinorTag);
  if (minor.length > 0 && (positive.some(isSexualTag) || all.some((t) => widensRating(t, api)))) {
    refused.push(...minor);
  }
  return { ok: refused.length === 0, tokens: refused };
}

/** Tag suggestions (autocomplete) never offer blocked tags. */
export function isSuggestionAllowed(tag: string): boolean {
  return !isBlockedTag(normalizeTag(tag));
}

/**
 * Structure of the help page. The texts live in the i18n files under
 * `helpCenter.*`; these lists only say which entries exist and in which
 * order, so tests can check that every entry has a German and English text.
 */

/** One article per area of the app – the "?" link of each view opens it. */
export const HELP_AREAS = [
  'convert',
  'compress',
  'download',
  'booru',
  'subscriptions',
  'swipe',
  'workflows',
  'pdf',
  'workshop',
  'archive',
  'settings',
  'admin',
] as const;
export type HelpArea = (typeof HELP_AREAS)[number];

export const FAQ_ITEMS = [
  'whichFormat',
  'whyBigger',
  'whyStutter',
  'mp4VsMkv',
  'localOrServer',
  'localNotWorking',
  'transparencyLost',
  'whereAreFiles',
  'whyCookies',
  'forgotPassword',
  'installApp',
  'quotaFull',
  'missingArea',
] as const;
export type FaqItem = (typeof FAQ_ITEMS)[number];

/** Sorted by the German term; the page re-sorts by the shown language. */
export const GLOSSARY_TERMS = [
  'archive',
  'bitrate',
  'codec',
  'compression',
  'container',
  'cookie',
  'dpi',
  'exif',
  'framerate',
  'userGroup',
  'hash',
  'https',
  'ldap',
  'lossless',
  'lossy',
  'magicBytes',
  'metadata',
  'nas',
  'ocr',
  'polygon',
  'resolution',
  'reverseProxy',
  'sampleRate',
  'smb',
  'steganography',
  'texture',
  'transparency',
  'vector',
  'wasm',
  'workflow',
] as const;
export type GlossaryTerm = (typeof GLOSSARY_TERMS)[number];

/**
 * Beginner guides in docs/ that the server ships next to the app
 * (/docs/<file> in German, /docs/en/<fileEn> in English).
 */
export const HELP_GUIDES = [
  { id: 'install', file: 'installation.md', fileEn: 'installation.md' },
  { id: 'nas', file: 'speicherorte.md', fileEn: 'storage.md' },
  { id: 'cookies', file: 'cookies.md', fileEn: 'cookies.md' },
  { id: 'api', file: 'api.md', fileEn: 'api.md' },
  { id: 'ldap', file: 'ldap.md', fileEn: 'ldap.md' },
] as const;

/** Link to a guide in the shown language (German or English). */
export function guideHref(guide: (typeof HELP_GUIDES)[number], language: string): string {
  return language.startsWith('de') ? `/docs/${guide.file}` : `/docs/en/${guide.fileEn}`;
}
export type HelpGuide = (typeof HELP_GUIDES)[number]['id'];

/** All i18n keys the help page needs (for the locale completeness test). */
export function helpI18nKeys(): string[] {
  return [
    ...HELP_AREAS.flatMap((a) => [`helpCenter.areas.${a}.title`, `helpCenter.areas.${a}.body`]),
    ...FAQ_ITEMS.flatMap((f) => [`helpCenter.faq.${f}.q`, `helpCenter.faq.${f}.a`]),
    ...GLOSSARY_TERMS.flatMap((g) => [
      `helpCenter.glossary.${g}.term`,
      `helpCenter.glossary.${g}.text`,
    ]),
    ...HELP_GUIDES.flatMap((g) => [
      `helpCenter.guides.${g.id}.title`,
      `helpCenter.guides.${g.id}.summary`,
    ]),
  ];
}

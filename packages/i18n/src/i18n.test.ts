import { describe, expect, it } from 'vitest';
import {
  CONVERSION_WARNINGS,
  ENGINE_ERROR_KEYS,
  ENTROPY_LEVELS,
  FIELD_KEYS,
  FIELD_VALUE_KEYS,
  FINDING_KEYS,
  PRIVACY_KINDS,
  CIPHERS,
  REPAIR_KINDS,
  REGION_KINDS,
  SHAMIR_ERROR_CODES,
  STEGO_ERROR_CODES,
  METADATA_GROUP_NAMES,
  METADATA_TAG_NAMES,
  STRUCTURE_KEYS,
  TEXT_ENCODINGS,
  WORKSHOP_ERROR_CODES,
  WORKSHOP_GROUPS,
  WORKSHOP_TRICKS,
  TEST_FILE_KINDS,
  TEST_FILLS,
  TEST_TONES,
  SCAN_FILTERS,
  DANGER_KEYS,
  PROGRAM_ABILITIES,
  LIBRARY_KINDS_KEYS,
  TIMELINE_LABELS,
  TIMELINE_WARNINGS,
  JPEG_CLUES,
  FORENSIC_FILTERS,
  STRING_KINDS,
  SSTV_MODES,
  PALETTE_EXPORTS,
  FILE_MAP_MODES,
  BYTE_KINDS,
  SIZE_FILE_KINDS,
  SIZE_PART_KINDS,
  SIZE_TIPS,
  HIDDEN_TEXT_KINDS,
  RELIEF_MODES,
  workshopTrickKeys,
  FORMATS,
  helpI18nKeys,
  purposeI18nKeys,
  ROUTE_REASONS,
  ROUTE_WARNINGS,
  formatI18nKeys,
  INVISIBLE_KINDS,
  META_SPOTS,
  ASCII_RAMPS,
  DITHERS,
  EMOJI_SET_IDS,
  RINGTONE_FORMATS,
  RETRO_PALETTE_IDS,
  QR_KINDS,
  TEXT_CODECS,
  WIFI_SECURITY,
} from '@conbert/core';
import {
  SUPPORTED_LANGUAGES,
  findMissingKeys,
  flattenMessages,
  getMessage,
  isLanguage,
  resources,
} from './index';

describe('locale files', () => {
  const flat = Object.fromEntries(
    SUPPORTED_LANGUAGES.map((l) => [l, flattenMessages(resources[l].translation)]),
  );

  it('German and English have exactly the same keys', () => {
    const de = Object.keys(flat['de'] ?? {}).sort();
    const en = Object.keys(flat['en'] ?? {}).sort();
    expect(
      de.filter((k) => !en.includes(k)),
      'missing in en.json',
    ).toEqual([]);
    expect(
      en.filter((k) => !de.includes(k)),
      'missing in de.json',
    ).toEqual([]);
  });

  it('contains no empty texts', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const empty = Object.entries(flat[language] ?? {})
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k);
      expect(empty, `empty texts in ${language}.json`).toEqual([]);
    }
  });

  it('uses the same {{placeholders}} in both languages', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [key, de] of Object.entries(flat['de'] ?? {})) {
      const en = flat['en']?.[key];
      if (en === undefined) continue;
      expect(placeholders(en), key).toEqual(placeholders(de));
    }
  });
});

describe('help-text guard', () => {
  it('every registered format has all its texts in German and English', () => {
    expect(findMissingKeys(FORMATS.flatMap(formatI18nKeys))).toEqual([]);
  });

  it('every help area, question, glossary term and guide has a text', () => {
    expect(findMissingKeys(helpI18nKeys())).toEqual([]);
    expect(findMissingKeys(purposeI18nKeys())).toEqual([]);
  });

  it('every conversion warning, routing reason and routing warning has a text', () => {
    const keys = [
      ...CONVERSION_WARNINGS.map((w) => `warnings.${w}`),
      ...ROUTE_REASONS.map((r) => `routing.reasons.${r}`),
      ...ROUTE_WARNINGS.map((w) => `routing.warnings.${w}`),
    ];
    expect(findMissingKeys(keys)).toEqual([]);
  });

  it('every engine error has a three-part text', () => {
    const keys = ENGINE_ERROR_KEYS.flatMap((k) => [`${k}.what`, `${k}.cause`, `${k}.action`]);
    expect(findMissingKeys(keys)).toEqual([]);
  });

  it('every workshop trick, group and explanation has a text', () => {
    const keys = [
      ...WORKSHOP_TRICKS.flatMap((t) => workshopTrickKeys(t.id)),
      ...WORKSHOP_GROUPS.flatMap((g) => [
        `workshop.groups.${g}.title`,
        `workshop.groups.${g}.intro`,
      ]),
      ...STRUCTURE_KEYS.map((k) => `workshop.structure.${k}`),
      ...REGION_KINDS.map((k) => `workshop.hex.kinds.${k}`),
      ...TEXT_ENCODINGS.map((e) => `workshop.identify.encodings.${e}`),
      ...ENTROPY_LEVELS.map((l) => `workshop.entropy.levels.${l}`),
      ...FINDING_KEYS.map((k) => `workshop.detective.findings.${k}`),
      ...FIELD_KEYS.map((k) => `workshop.fields.${k}`),
      ...FIELD_VALUE_KEYS.map((k) => `workshop.fieldValues.${k}`),
      ...WORKSHOP_ERROR_CODES.map((c) => `workshop.errors.${c}`),
      ...RETRO_PALETTE_IDS.map((p) => `workshop.pixelart.palettes.${p}`),
      ...DITHERS.map((d) => `workshop.pixelart.dithers.${d}`),
      ...EMOJI_SET_IDS.map((s) => `workshop.emojimosaic.sets.${s}`),
      ...RINGTONE_FORMATS.map((f) => `workshop.ringtone.formats.${f}`),
      ...QR_KINDS.map((k) => `workshop.qr.kinds.${k}`),
      ...TEST_FILE_KINDS.flatMap((k) => [
        `workshop.testfiles.kinds.${k}.title`,
        `workshop.testfiles.kinds.${k}.help`,
      ]),
      ...TEST_FILLS.map((f) => `workshop.testfiles.fills.${f}`),
      ...TEST_TONES.map((v) => `workshop.testfiles.tones.${v}`),
      ...SCAN_FILTERS.map((f) => `workshop.scanner.filters.${f}`),
      // Plural keys (_one/_other) are checked through their forms.
      ...DANGER_KEYS.filter((k) => k !== 'oleObject').map((k) => `workshop.danger.findings.${k}`),
      ...PROGRAM_ABILITIES.flatMap((a) => [
        `workshop.program.ability.${a}`,
        `workshop.program.abilityWhy.${a}`,
      ]),
      ...LIBRARY_KINDS_KEYS.map((k) => `workshop.program.libs.${k}`),
      ...TIMELINE_LABELS.map((l) => `workshop.timeline.labels.${l}`),
      ...TIMELINE_WARNINGS.map((w) => `workshop.timeline.warnings.${w}`),
      ...JPEG_CLUES.map((c) => `workshop.jpegorigin.clues.${c}`),
      ...FORENSIC_FILTERS.flatMap((f) => [
        `workshop.magnifier.filters.${f}.label`,
        `workshop.magnifier.filters.${f}.help`,
      ]),
      ...STRING_KINDS.map((k) => `workshop.strings.kind.${k}`),
      ...SSTV_MODES.map((m) => `workshop.sstv.modes.${m}`),
      ...PALETTE_EXPORTS.map((f) => `workshop.palette.formats.${f}`),
      ...FILE_MAP_MODES.flatMap((m) => [
        `workshop.filemap.modes.${m}`,
        `workshop.filemap.modeHelp.${m}`,
      ]),
      ...BYTE_KINDS.map((k) => `workshop.filemap.kinds.${k}`),
      ...SIZE_FILE_KINDS.map((k) => `workshop.sizecheck.kinds.${k}`),
      ...SIZE_PART_KINDS.flatMap((k) => [
        `workshop.sizecheck.parts.${k}`,
        `workshop.sizecheck.partHelp.${k}`,
      ]),
      ...SIZE_TIPS.map((k) => `workshop.sizecheck.tips.${k}`),
      ...HIDDEN_TEXT_KINDS.flatMap((k) => [
        `workshop.hiddentext.kinds.${k}`,
        `workshop.hiddentext.kindHelp.${k}`,
      ]),
      ...RELIEF_MODES.flatMap((m) => [
        `workshop.lithophane.modes.${m}`,
        `workshop.lithophane.modeHelp.${m}`,
        `workshop.lithophane.printTips.${m}`,
      ]),
      ...TEXT_CODECS.map((c) => `workshop.encode.codecs.${c}`),
      ...WIFI_SECURITY.map((s) => `workshop.qr.securities.${s}`),
      ...Object.keys(ASCII_RAMPS).map((r) => `workshop.ascii.ramps.${r}`),
      ...PRIVACY_KINDS.flatMap((k) => [
        `workshop.privacy.kinds.${k}.title`,
        `workshop.privacy.kinds.${k}.help`,
      ]),
      ...REPAIR_KINDS.flatMap((k) => [
        `workshop.repair.fixes.${k}.title`,
        `workshop.repair.fixes.${k}.help`,
      ]),
      ...['high', 'medium', 'low'].map((l) => `workshop.privacy.levels.${l}`),
      ...[...SHAMIR_ERROR_CODES, 'unknown'].map((c) => `workshop.treasure.errors.${c}`),
      ...STEGO_ERROR_CODES.map((c) => `workshop.stego.errors.${c}`),
      ...METADATA_TAG_NAMES.map((n) => `metadata.tagNames.${n}`),
      ...METADATA_GROUP_NAMES.map((g) => `metadata.groupNames.${g}`),
      ...META_SPOTS.map((spot) => `workshop.metasecret.spots.${spot}`),
      ...['unsupported', 'pdf-locked', 'failed', 'wrong-password', 'damaged', 'readFailed'].map(
        (c) => `workshop.metasecret.errors.${c}`,
      ),
      ...INVISIBLE_KINDS.flatMap((k) =>
        ['name', 'short', 'help'].map((part) => `workshop.invisible.kinds.${k}.${part}`),
      ),
      ...['nothing-hidden', 'needs-password', 'wrong-password', 'damaged'].map(
        (c) => `workshop.invisible.errors.${c}`,
      ),
      ...CIPHERS.flatMap((c) =>
        ['name', 'help', 'crack'].map((part) => `workshop.ciphers.methods.${c}.${part}`),
      ),
    ];
    expect(findMissingKeys(keys)).toEqual([]);
  });

  it('reports missing keys per language', () => {
    expect(findMissingKeys(['does.not.exist'])).toEqual([
      { language: 'de', key: 'does.not.exist' },
      { language: 'en', key: 'does.not.exist' },
    ]);
  });
});

describe('helpers', () => {
  it('looks up nested keys', () => {
    expect(getMessage('de', 'formats.png.name')).toBe('PNG-Bild');
    expect(getMessage('en', 'formats.png.name')).toBe('PNG image');
    expect(getMessage('en', 'formats.png')).toBeUndefined();
    expect(getMessage('en', 'formats.png.name.deeper')).toBeUndefined();
  });

  it('recognizes supported languages', () => {
    expect(isLanguage('de')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

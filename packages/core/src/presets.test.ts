import { describe, expect, it } from 'vitest';
import {
  EMAIL_TARGET_MB,
  PURPOSES,
  PURPOSE_RULES,
  choosePurpose,
  purposeI18nKeys,
} from './presets';
import { getFormat } from './formats';

const always = () => true;

describe('choosePurpose', () => {
  it('turns an iPhone photo into a JPG for messengers', () => {
    const r = choosePurpose('messenger', 'heic', always);
    expect(r).toEqual({
      kind: 'choice',
      choice: {
        purpose: 'messenger',
        targetExt: 'jpg',
        options: { quality: 80, stripMetadata: true },
        reasonKey: 'purposes.messenger.why.image',
      },
    });
  });

  it('says a JPG is already fine for messengers', () => {
    expect(choosePurpose('messenger', 'jpg', always)).toEqual({
      kind: 'alreadyFine',
      reasonKey: 'purposes.messenger.why.image',
    });
  });

  it('compresses to a target size for e-mail, also when the format already fits', () => {
    const r = choosePurpose('email', 'mp4', always);
    expect(r.kind).toBe('choice');
    if (r.kind !== 'choice') return;
    expect(r.choice.targetExt).toBe('mp4');
    expect(r.choice.compress).toEqual({ level: 'target', targetMb: EMAIL_TARGET_MB });
  });

  it('keeps the format when saving space', () => {
    const r = choosePurpose('saveSpace', 'png', always);
    expect(r.kind === 'choice' && r.choice.targetExt).toBeNull();
  });

  it('falls back to the next target when the first one cannot be reached', () => {
    const r = choosePurpose('print', 'png', (ext) => ext !== 'pdf');
    expect(r.kind === 'choice' && r.choice.targetExt).toBe('jpg');
  });

  it('does not fit when no target can be reached or the category has no rule', () => {
    expect(choosePurpose('print3d', 'mp3', always).kind).toBe('notApplicable');
    expect(choosePurpose('web', 'png', () => false).kind).toBe('notApplicable');
    expect(choosePurpose('web', 'unknownext', always).kind).toBe('notApplicable');
  });
});

describe('purpose rules', () => {
  it('only name targets the format registry knows', () => {
    for (const p of PURPOSES) {
      for (const rule of Object.values(PURPOSE_RULES[p])) {
        for (const ext of rule.targets) expect(getFormat(ext), `${p}: ${ext}`).toBeDefined();
      }
    }
  });

  it('list a label, a summary and reasons for every purpose', () => {
    const keys = purposeI18nKeys();
    expect(keys).toContain('purposes.print3d.why.model');
    expect(new Set(keys).size).toBe(keys.length);
  });
});

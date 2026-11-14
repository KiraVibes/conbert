import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recommendedTargets } from '../formats';
import { convertSubtitles, decodeSubtitleText, parseSubtitles, subtitleFormatOf } from './convert';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '__fixtures__', name)));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const convert = (name: string, to: string, options: Record<string, unknown> = {}) =>
  text(convertSubtitles(fixture(name), name.split('.').pop() ?? '', to, options));

describe('reading subtitles', () => {
  it('reads old SRT files in Windows-1252 and keeps italics', () => {
    const cues = parseSubtitles(decodeSubtitleText(fixture('sample.srt')), 'srt');
    expect(cues).toEqual([
      { start: 1000, end: 2500, text: 'Grüße aus <i>Köln</i>!' },
      { start: 3000, end: 4000, text: 'Zwei\nZeilen' },
    ]);
  });

  it('reads WebVTT without notes, voices and classes', () => {
    const cues = parseSubtitles(decodeSubtitleText(fixture('sample.vtt')), 'vtt');
    expect(cues).toEqual([
      { start: 1000, end: 2500, text: 'Hallo & <b>willkommen</b>' },
      { start: 3000, end: 4000, text: 'Tschüss' },
    ]);
  });

  it('reads ASS: commas in the text, line breaks, no comments or drawings', () => {
    const cues = parseSubtitles(decodeSubtitleText(fixture('sample.ass')), 'ass');
    expect(cues).toEqual([
      { start: 1000, end: 2500, text: 'Oben, mit <i>Komma</i>' },
      { start: 3000, end: 4000, text: 'Erste\nZweite' },
    ]);
  });
});

describe('writing subtitles', () => {
  it('SRT → WebVTT', () => {
    expect(convert('sample.srt', 'vtt')).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nGrüße aus <i>Köln</i>!\n\n' +
        '00:00:03.000 --> 00:00:04.000\nZwei\nZeilen\n',
    );
  });

  it('WebVTT → SRT (entities become characters again)', () => {
    expect(convert('sample.vtt', 'srt')).toBe(
      '1\n00:00:01,000 --> 00:00:02,500\nHallo & <b>willkommen</b>\n\n' +
        '2\n00:00:03,000 --> 00:00:04,000\nTschüss\n',
    );
  });

  it('SRT → ASS with italics as ASS codes', () => {
    const ass = convert('sample.srt', 'ass');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain(
      'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Grüße aus {\\i1}Köln{\\i0}!',
    );
    expect(ass).toContain('Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Zwei\\NZeilen');
    // And back: the same cues.
    const back = parseSubtitles(ass, 'ass');
    expect(back.map((c) => c.text)).toEqual(['Grüße aus <i>Köln</i>!', 'Zwei\nZeilen']);
  });

  it('escapes < and & for WebVTT, keeps the markup', () => {
    const srt = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n3 < 4 & <i>ja</i>\n');
    expect(text(convertSubtitles(srt, 'srt', 'vtt', {}))).toContain('3 &lt; 4 &amp; <i>ja</i>');
  });

  it('only the words as plain text', () => {
    expect(convert('sample.ass', 'txt')).toBe('Oben, mit Komma\nErste Zweite\n');
  });

  it('moves all subtitles earlier or later', () => {
    expect(convert('sample.srt', 'srt', { subtitleShift: 1.5 })).toContain(
      '00:00:02,500 --> 00:00:04,000',
    );
    // Earlier than the start: the first one is cut at 0, nothing goes negative.
    const earlier = convert('sample.srt', 'srt', { subtitleShift: -2 });
    expect(earlier).toContain('1\n00:00:00,000 --> 00:00:00,500');
    expect(earlier).toContain('2\n00:00:01,000 --> 00:00:02,000');
  });

  it('accepts .ssa as ASS', () => {
    expect(convert('sample.ass', 'srt')).toBe(
      text(convertSubtitles(fixture('sample.ass'), 'ssa', 'srt', {})),
    );
  });

  it('explains a file without any subtitles', () => {
    expect(() =>
      convertSubtitles(new TextEncoder().encode('kein Untertitel'), 'srt', 'vtt', {}),
    ).toThrow(expect.objectContaining({ messageKey: 'errors.subtitlesEmpty' }));
  });
});

describe('recommended targets', () => {
  it('recommends other subtitle formats for subtitles', () => {
    expect(recommendedTargets('srt')).toEqual(['vtt', 'ass', 'txt']);
    expect(recommendedTargets('ssa')).toEqual(['srt', 'vtt', 'txt']);
  });
});

describe('format by content', () => {
  it('tells SRT, WebVTT and ASS apart without the file name', () => {
    expect(subtitleFormatOf(decodeSubtitleText(fixture('sample.srt')))).toBe('srt');
    expect(subtitleFormatOf(decodeSubtitleText(fixture('sample.vtt')))).toBe('vtt');
    expect(subtitleFormatOf(decodeSubtitleText(fixture('sample.ass')))).toBe('ass');
  });
});

describe('LRC lyrics', () => {
  const lrc = [
    '[ar:Someone]',
    '[ti:A song]',
    '[offset:+200]',
    '[00:01.00]First line',
    '[00:03.50][00:20.00]Chorus <00:03.80>with <00:04.10>words',
    '[00:06.0]',
    '[00:30.123]Last line',
  ].join('\n');

  it('is recognised by its content', () => {
    expect(subtitleFormatOf(lrc)).toBe('lrc');
    expect(subtitleFormatOf('[00:01.00]Hi')).toBe('lrc');
    expect(subtitleFormatOf('1\n00:00:01,000 --> 00:00:02,000\nHi\n')).toBe('srt');
  });

  it('turns stamped lines into cues that last until the next line', () => {
    const cues = parseSubtitles(lrc, 'lrc');
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [800, 3300, 'First line'],
      [3300, 5800, 'Chorus with words'],
      // The empty line at 6.0 ends the chorus; far-away next lines are capped at 10 s.
      [19800, 29800, 'Chorus with words'],
      [29923, 35923, 'Last line'],
    ]);
  });

  it('converts to SRT like any other subtitle file', () => {
    const srt = new TextDecoder().decode(
      convertSubtitles(new TextEncoder().encode('[00:01.50]Hallo Welt\n'), 'lrc', 'srt', {}),
    );
    expect(srt).toContain('00:00:01,500 --> 00:00:07,500');
    expect(srt).toContain('Hallo Welt');
  });
});

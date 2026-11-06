import type { Category } from './engine';
import { getFormat, normalizeExt } from './formats';

/**
 * Which kind of file can sensibly become which other kind. Engines (and the
 * router's chains) could technically do more – e.g. PNG → GIF → MP3, or an
 * MP3 as a video without picture – but such results only confuse.
 */
const SENSIBLE: Record<Category, readonly Category[]> = {
  image: ['image', 'vector', 'pdf'],
  vector: ['vector', 'image', 'pdf'],
  audio: ['audio'],
  // Plus animated images (GIF), see below.
  video: ['video', 'audio'],
  // Pages rendered as pictures (e.g. DOCX → PDF → PNG).
  document: ['document', 'ebook', 'pdf', 'image'],
  ebook: ['ebook', 'document', 'pdf'],
  pdf: ['pdf', 'image', 'document', 'ebook'],
  '3d': ['3d'],
  archive: ['archive'],
  font: ['font'],
  // Spreadsheets can become PDFs or web pages (LibreOffice).
  data: ['data', 'pdf', 'document'],
  midi: ['midi', 'audio'],
};

/** What speech recognition writes. */
const TRANSCRIPTS = new Set(['srt', 'vtt', 'txt']);

/** Soundfonts are filed under "audio", but only convert among themselves. */
const SOUNDFONTS = new Set(['sf2', 'sf3', 'dls']);

/** Does converting `inputExt` to `outputExt` make sense? Unknown formats are allowed. */
export function isSensibleTarget(inputExt: string, outputExt: string): boolean {
  const fromExt = normalizeExt(inputExt);
  const toExt = normalizeExt(outputExt);
  const from = getFormat(fromExt);
  const to = getFormat(toExt);
  if (!from || !to) return true;

  if (SOUNDFONTS.has(from.ext) || SOUNDFONTS.has(to.ext)) {
    return SOUNDFONTS.has(from.ext) && SOUNDFONTS.has(to.ext);
  }
  // Speech to text: sound and videos become subtitles or plain text (Whisper).
  if (from.category === 'audio' || from.category === 'video') {
    if (TRANSCRIPTS.has(to.ext)) return true;
  }
  // Moving pictures: animated image ↔ video (GIF → MP4, MP4 → GIF).
  if (from.category === 'image' && to.category === 'video') return from.supportsAnimation === true;
  if (from.category === 'video' && to.category === 'image') return to.supportsAnimation === true;
  return SENSIBLE[from.category].includes(to.category);
}

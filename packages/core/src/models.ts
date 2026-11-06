/**
 * AI model files the server downloads on first use (Whisper, background
 * removal, upscaling). Size and SHA-256 are fixed here: a download is only
 * kept when both match.
 */
export interface ModelFile {
  id: string;
  /** File name in the model folder (and in the download folder). */
  file: string;
  bytes: number;
  sha256: string;
  /** Full download address; without it the file is taken from a base folder URL. */
  url?: string;
}

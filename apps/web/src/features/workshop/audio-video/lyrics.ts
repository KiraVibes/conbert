import { LYRICS_FILE_TYPES, type LyricsSource, type WhisperLanguage } from '@conbert/core';
import { useAvailableEngines } from '@/engines/use-engines';
import { useCan } from '@/features/auth/use-auth';
import { extOf } from '../audio-convert';

export interface LyricsChoice {
  source: LyricsSource;
  file: File | null;
  language: WhisperLanguage;
}

/** Is speech recognition (Whisper) there and allowed for this user? */
export function useSpeechAvailable(): boolean {
  const { engines, serverAvailable } = useAvailableEngines();
  const allowed = useCan('ai');
  const whisper = engines.find((e) => e.id === 'whisper' && e.runtime === 'server');
  return serverAvailable && allowed && whisper !== undefined && whisper.status !== 'error';
}

export const lyricsFileOk = (file: File | null) =>
  !file || LYRICS_FILE_TYPES.includes(extOf(file.name));

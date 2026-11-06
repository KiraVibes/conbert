import { ConversionError } from '@conbert/core';
import type { ModelStore } from '../models/model-store';

/** Set once at startup (app.ts); the Whisper engine reads it from here. */
let current: { models: ModelStore; defaultModel: () => string } | null = null;

export function configureWhisper(models: ModelStore, defaultModel: () => string): void {
  current = { models, defaultModel };
}

export function whisperSetup(): { models: ModelStore; defaultModel: () => string } {
  if (!current) throw new ConversionError('errors.whisperFailed', 'whisper is not configured');
  return current;
}

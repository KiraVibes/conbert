/**
 * An error an engine reports to the UI. `messageKey` points to a three-part
 * text (`<key>.what`, `<key>.cause`, `<key>.action`) in @conbert/i18n;
 * `details` holds technical information that is only shown on request.
 */
export class ConversionError extends Error {
  constructor(
    readonly messageKey: string,
    readonly details?: string,
  ) {
    super(details ? `${messageKey}: ${details}` : messageKey);
    this.name = 'ConversionError';
  }
}

/** Error keys every engine may use. All have texts in @conbert/i18n. */
export const ENGINE_ERROR_KEYS = [
  'errors.engineLoadFailed',
  'errors.metadataReadFailed',
  'errors.metadataWriteFailed',
  'errors.notIsolated',
  'errors.convertFailed',
  'errors.outOfMemory',
  'errors.serverOutOfMemory',
  'errors.formatUnavailable',
  'errors.noMatchingStream',
  'errors.allSilent',
  'errors.coverInvalid',
] as const;

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

export function abortError(): DOMException {
  return new DOMException('The conversion was cancelled.', 'AbortError');
}

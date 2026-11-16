import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineLoadError } from './load-error';

describe('engineLoadError', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says "not stored for offline" when the server can not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await engineLoadError(new Error('wasm missing'));
    expect(error.messageKey).toBe('errors.engineOffline');
    expect(error.details).toContain('wasm missing');
  });

  it('keeps the general message while the server answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const error = await engineLoadError(new Error('broken'));
    expect(error.messageKey).toBe('errors.engineLoadFailed');
  });
});

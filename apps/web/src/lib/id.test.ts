import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from './id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a v4 UUID', () => {
    expect(createId()).toMatch(UUID_V4);
  });

  it('works without crypto.randomUUID (plain HTTP on a LAN address)', () => {
    vi.stubGlobal('isSecureContext', false);
    const spy = vi.spyOn(crypto, 'randomUUID');
    const ids = new Set(Array.from({ length: 100 }, createId));
    expect(spy).not.toHaveBeenCalled();
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});

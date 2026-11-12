import { describe, expect, it } from 'vitest';
import { cardTimeKey, stamp } from './stamp';

describe('card time stamps', () => {
  const now = new Date('2026-11-12T15:00:00');
  it('shows day, month and time – the year only when it is not this year', () => {
    expect(stamp(new Date('2026-11-12T14:03:00').toISOString(), 'de-DE', now)).toBe(
      '12.11., 14:03',
    );
    expect(stamp(new Date('2025-03-01T09:30:00').toISOString(), 'de-DE', now)).toBe(
      '01.03.2025, 09:30',
    );
  });
  it('picks the label from the status and whether a subscription started it', () => {
    expect(cardTimeKey('done', false)).toBe('cardTime.done');
    expect(cardTimeKey('done', true)).toBe('cardTime.feedDone');
    expect(cardTimeKey('error', true)).toBe('cardTime.ended');
    expect(cardTimeKey('running', true)).toBe('cardTime.feedStarted');
    expect(cardTimeKey('paused', false)).toBe('cardTime.started');
  });
});

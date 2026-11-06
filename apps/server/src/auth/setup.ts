import { randomInt, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AuthMode } from '@conbert/schemas';
import type { DbOrTx } from '../db';
import { appSettings } from '../db/schema';

interface AuthState {
  setupDone: boolean;
  authMode: AuthMode;
}

const KEY = 'auth';

export function getAuthState(db: DbOrTx): AuthState {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  const value = row?.value as Partial<AuthState> | undefined;
  return {
    setupDone: value?.setupDone === true,
    authMode: value?.authMode === 'proxy' ? 'proxy' : 'local',
  };
}

export function markSetupDone(db: DbOrTx, authMode: AuthMode): void {
  const value: AuthState & { completedAt: string } = {
    setupDone: true,
    authMode,
    completedAt: new Date().toISOString(),
  };
  db.insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

/** Without look-alike characters (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A one-time code like "K7QM-3XRP" that only the server operator can see. */
export function generateSetupCode(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)] ?? 'X';
  const part = () => Array.from({ length: 4 }, pick).join('');
  return `${part()}-${part()}`;
}

function normalize(code: string): Buffer {
  return Buffer.from(code.toUpperCase().replace(/[\s-]/g, ''));
}

export function setupCodeMatches(expected: string, given: string): boolean {
  const a = normalize(expected);
  const b = normalize(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

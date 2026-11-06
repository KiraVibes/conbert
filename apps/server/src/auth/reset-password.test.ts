import { describe, expect, it } from 'vitest';
import { ADMIN, memoryDb, setupAdmin, testApp } from '../test/helpers';
import { randomPassword, resetPassword } from './reset-password';

describe('reset-password command', () => {
  it('makes long, typeable passwords', () => {
    const a = randomPassword();
    expect(a).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
    expect(randomPassword()).not.toBe(a);
  });

  it('sets a new password and signs the user out everywhere', async () => {
    const db = memoryDb();
    const app = await testApp({}, { db });
    const cookie = await setupAdmin(app);

    const password = await resetPassword(db, 'ADMIN');
    expect(password).toBeTruthy();

    // The old session is gone …
    const me = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } });
    expect(me.json<{ user: unknown }>().user).toBeNull();
    // … the old password no longer works, the new one does.
    const old = await app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: ADMIN.username, password },
    });
    expect(fresh.statusCode).toBe(200);
    await app.close();
  });

  it('says so when there is no such account', async () => {
    expect(await resetPassword(memoryDb(), 'nobody')).toBeNull();
  });
});

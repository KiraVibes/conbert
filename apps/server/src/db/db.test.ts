import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { openDatabase, schema } from './index';

const migrationsDir = loadConfig({}).migrationsDir;

describe('database', () => {
  it('creates all tables from the migrations', () => {
    const db = openDatabase(':memory:', migrationsDir);
    const tables = db.$client
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'app_settings',
        'files',
        'jobs',
        'sessions',
        'user_settings',
        'users',
      ]),
    );
  });

  it('deletes sessions and files together with their user', () => {
    const db = openDatabase(':memory:', migrationsDir);
    db.insert(schema.users).values({ id: 'u1', username: 'anna' }).run();
    db.insert(schema.sessions)
      .values({ id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 1000) })
      .run();
    db.insert(schema.files)
      .values({
        id: 'f1',
        userId: 'u1',
        originalName: 'a.png',
        ext: 'png',
        size: 1,
        path: '/data/uploads/f1',
        expiresAt: new Date(),
      })
      .run();
    db.delete(schema.users).where(eq(schema.users.id, 'u1')).run();
    expect(db.select().from(schema.sessions).all()).toEqual([]);
    expect(db.select().from(schema.files).all()).toEqual([]);
  });

  it('fills created_at automatically', () => {
    const db = openDatabase(':memory:', migrationsDir);
    db.insert(schema.users).values({ id: 'u1', username: 'ben' }).run();
    const user = db.select().from(schema.users).get();
    expect(user?.createdAt).toBeInstanceOf(Date);
    expect(Math.abs((user?.createdAt.getTime() ?? 0) - Date.now())).toBeLessThan(5000);
  });
});

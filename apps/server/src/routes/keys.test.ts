import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  Decrypter,
  Encrypter,
  armor,
  generateX25519Identity,
  identityToRecipient,
} from 'age-encryption';
import type { Contact, MyKey, SharedKey, WorkflowRunDto } from '@conbert/schemas';
import { recordFile } from '../storage/uploads';
import { sessionCookie, setupAdmin, testApp } from '../test/helpers';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');

let app: FastifyInstance;
let dataDir: string;
let admin: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-keys-'));
  app = await testApp({ CONBERT_DATA_DIR: dataDir });
  admin = await setupAdmin(app);
});
afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const call = (
  cookie: string,
  method: 'GET' | 'PUT' | 'PATCH' | 'DELETE' | 'POST',
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });

/** A key pair as the browser makes it: the private key locked with the vault password. */
async function makeKey(password: string) {
  const identity = await generateX25519Identity();
  const lock = new Encrypter();
  lock.setPassphrase(password);
  lock.setScryptWorkFactor(10);
  return {
    identity,
    publicKey: await identityToRecipient(identity),
    lockedIdentity: armor.encode(await lock.encrypt(identity)),
  };
}

async function secondUser(): Promise<{ cookie: string; id: string }> {
  const created = await call(admin, 'POST', '/api/users', {
    username: 'bea',
    password: 'ein langes passwort',
  });
  const id = created.json<{ user: { id: string } }>().user.id;
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'bea', password: 'ein langes passwort' },
  });
  return { cookie: sessionCookie(login), id };
}

describe('key vault', () => {
  it('stores only a locked private key and gives it back to its owner', async () => {
    const key = await makeKey('tresor passwort 123');
    expect((await call(admin, 'GET', '/api/keys/me')).json()).toEqual({ key: null });
    const saved = await call(admin, 'PUT', '/api/keys/me', {
      publicKey: key.publicKey,
      lockedIdentity: key.lockedIdentity,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const mine = (await call(admin, 'GET', '/api/keys/me')).json<{ key: MyKey }>().key;
    expect(mine).toMatchObject({ publicKey: key.publicKey, shared: false });
    // The owner can open it again with the vault password.
    const d = new Decrypter();
    d.addPassphrase('tresor passwort 123');
    expect(await d.decrypt(armor.decode(mine.lockedIdentity), 'text')).toBe(key.identity);

    // An unlocked key (or one locked for a key instead of a password) is refused.
    const plain = await call(admin, 'PUT', '/api/keys/me', {
      publicKey: key.publicKey,
      lockedIdentity: `-----BEGIN AGE ENCRYPTED FILE-----\n${key.identity}\n-----END AGE ENCRYPTED FILE-----`,
    });
    expect(plain.json<{ error: { code: string } }>().error.code).toBe('KEY_NOT_LOCKED');
    const forKey = new Encrypter();
    forKey.addRecipient(key.publicKey);
    const notPassword = await call(admin, 'PUT', '/api/keys/me', {
      publicKey: key.publicKey,
      lockedIdentity: armor.encode(await forKey.encrypt(key.identity)),
    });
    expect(notPassword.json<{ error: { code: string } }>().error.code).toBe('KEY_NOT_LOCKED');
    expect(
      (
        await call(admin, 'PUT', '/api/keys/me', {
          publicKey: 'age1quatsch',
          lockedIdentity: key.lockedIdentity,
        })
      ).json<{
        error: { code: string };
      }>().error.code,
    ).toBe('KEY_INVALID');
  });

  it('shows other users only the public keys they chose to share', async () => {
    const bea = await secondUser();
    const beaKey = await makeKey('beas tresor passwort');
    await call(bea.cookie, 'PUT', '/api/keys/me', {
      publicKey: beaKey.publicKey,
      lockedIdentity: beaKey.lockedIdentity,
    });
    expect((await call(admin, 'GET', '/api/keys/directory')).json()).toEqual({ keys: [] });
    await call(bea.cookie, 'PATCH', '/api/keys/me', { shared: true });
    const keys = (await call(admin, 'GET', '/api/keys/directory')).json<{ keys: SharedKey[] }>()
      .keys;
    expect(keys).toEqual([
      { userId: bea.id, username: 'bea', displayName: null, publicKey: beaKey.publicKey },
    ]);
    // Never the locked private key of someone else, and not your own entry.
    expect(JSON.stringify(keys)).not.toContain('BEGIN AGE');
    expect((await call(bea.cookie, 'GET', '/api/keys/directory')).json()).toEqual({ keys: [] });
  });

  it('a workflow encrypts for another user, who can open it – nobody else', async () => {
    const bea = await secondUser();
    const beaKey = await makeKey('beas tresor passwort');
    await call(bea.cookie, 'PUT', '/api/keys/me', {
      publicKey: beaKey.publicKey,
      lockedIdentity: beaKey.lockedIdentity,
      shared: true,
    });
    const me = await call(admin, 'GET', '/api/auth/status');
    const userId = me.json<{ user: { id: string } }>().user.id;
    const id = randomUUID();
    const target = path.join(dataDir, 'uploads', id);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(fixtures, 'sample.png'), target);
    await recordFile(app.conbert, { id, userId, filePath: target, name: 'foto.png', size: 1 });

    const res = await call(admin, 'POST', '/api/workflows/quick-run', {
      fileIds: [id],
      name: 'Für Bea',
      steps: [{ kind: 'workshop', trick: 'encrypt', params: { userIds: [bea.id] } }],
    });
    expect(res.statusCode, res.body).toBe(201);
    await (app.conbert.workflows.queue as unknown as { idle(): Promise<void> }).idle();
    const runId = res.json<{ run: WorkflowRunDto }>().run.id;
    const run = (await call(admin, 'GET', `/api/workflow-runs/${runId}`)).json<{
      run: WorkflowRunDto;
    }>().run;
    expect(run.files[0], JSON.stringify(run)).toMatchObject({
      status: 'done',
      resultName: 'foto.png.age',
    });
    const content = await call(admin, 'GET', `/api/files/${run.files[0]?.resultFileId}/content`);
    const encrypted = new Uint8Array(content.rawPayload);
    expect(new TextDecoder().decode(encrypted.subarray(0, 21))).toBe('age-encryption.org/v1');
    const d = new Decrypter();
    d.addIdentity(beaKey.identity);
    expect(Buffer.from(await d.decrypt(encrypted))).toEqual(
      readFileSync(path.join(fixtures, 'sample.png')),
    );
    // Someone else's key doesn't open it.
    const other = new Decrypter();
    other.addIdentity(await generateX25519Identity());
    await expect(other.decrypt(encrypted)).rejects.toThrow();
  });

  it('a workflow without any recipient explains why', async () => {
    const me = await call(admin, 'GET', '/api/auth/status');
    const userId = me.json<{ user: { id: string } }>().user.id;
    const id = randomUUID();
    const target = path.join(dataDir, 'uploads', id);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(fixtures, 'sample.png'), target);
    await recordFile(app.conbert, { id, userId, filePath: target, name: 'foto.png', size: 1 });
    const res = await call(admin, 'POST', '/api/workflows/quick-run', {
      fileIds: [id],
      name: 'Niemand',
      steps: [{ kind: 'workshop', trick: 'encrypt', params: { self: true } }],
    });
    await (app.conbert.workflows.queue as unknown as { idle(): Promise<void> }).idle();
    const runId = res.json<{ run: WorkflowRunDto }>().run.id;
    const run = (await call(admin, 'GET', `/api/workflow-runs/${runId}`)).json<{
      run: WorkflowRunDto;
    }>().run;
    expect(run.files[0]?.error?.messageKey).toBe('errors.keyNoRecipients');
  });
});

describe('contact book', () => {
  const code = (res: { json: <T>() => T }) => res.json<{ error: { code: string } }>().error.code;

  it('keeps contacts per user: add, rename, note, delete', async () => {
    const anna = await makeKey('egal egal egal');
    const created = await call(admin, 'POST', '/api/keys/contacts', {
      name: '  Anna  ',
      publicKey: ` ${anna.publicKey} `,
      note: 'Schwester',
    });
    expect(created.statusCode, created.body).toBe(201);
    const contact = created.json<{ contact: Contact }>().contact;
    expect(contact).toMatchObject({ name: 'Anna', publicKey: anna.publicKey, note: 'Schwester' });

    // The same key twice is refused and names the contact it already belongs to.
    const twice = await call(admin, 'POST', '/api/keys/contacts', {
      name: 'Anna 2',
      publicKey: anna.publicKey,
    });
    expect(twice.statusCode).toBe(409);
    expect(code(twice)).toBe('CONTACT_EXISTS');
    const wrong = await call(admin, 'POST', '/api/keys/contacts', {
      name: 'Kaputt',
      publicKey: 'age1quatschquatschquatsch',
    });
    expect(code(wrong)).toBe('CONTACT_KEY_INVALID');
    // A private key never goes into the contact book.
    const secret = await call(admin, 'POST', '/api/keys/contacts', {
      name: 'Geheim',
      publicKey: anna.identity,
    });
    expect(code(secret)).toBe('CONTACT_KEY_INVALID');

    const renamed = await call(admin, 'PATCH', `/api/keys/contacts/${contact.id}`, {
      name: 'Anna M.',
      note: null,
    });
    expect(renamed.json<{ contact: Contact }>().contact).toMatchObject({
      name: 'Anna M.',
      note: null,
      publicKey: anna.publicKey,
    });

    // Another user sees nothing and can't change or delete it.
    const bea = await secondUser();
    expect((await call(bea.cookie, 'GET', '/api/keys/contacts')).json()).toEqual({
      contacts: [],
    });
    expect(
      (await call(bea.cookie, 'PATCH', `/api/keys/contacts/${contact.id}`, { name: 'x' }))
        .statusCode,
    ).toBe(404);
    expect((await call(bea.cookie, 'DELETE', `/api/keys/contacts/${contact.id}`)).statusCode).toBe(
      404,
    );
    // Bea may keep the same key under her own name.
    const beas = await call(bea.cookie, 'POST', '/api/keys/contacts', {
      name: 'Anna (Arbeit)',
      publicKey: anna.publicKey,
    });
    expect(beas.statusCode).toBe(201);

    const list = (await call(admin, 'GET', '/api/keys/contacts')).json<{ contacts: Contact[] }>();
    expect(list.contacts.map((c) => c.name)).toEqual(['Anna M.']);
    expect((await call(admin, 'DELETE', `/api/keys/contacts/${contact.id}`)).statusCode).toBe(204);
    expect((await call(admin, 'GET', '/api/keys/contacts')).json()).toEqual({ contacts: [] });
  });

  it('a workflow encrypts for contacts of its owner – never for someone else’s', async () => {
    const anna = await makeKey('egal egal egal');
    const contact = (
      await call(admin, 'POST', '/api/keys/contacts', { name: 'Anna', publicKey: anna.publicKey })
    ).json<{ contact: Contact }>().contact;

    const runFor = async (cookie: string, contactIds: string[]) => {
      const me = await call(cookie, 'GET', '/api/auth/status');
      const userId = me.json<{ user: { id: string } }>().user.id;
      const id = randomUUID();
      const target = path.join(dataDir, 'uploads', id);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(fixtures, 'sample.png'), target);
      await recordFile(app.conbert, { id, userId, filePath: target, name: 'foto.png', size: 1 });
      const res = await call(cookie, 'POST', '/api/workflows/quick-run', {
        fileIds: [id],
        name: 'Für Anna',
        steps: [{ kind: 'workshop', trick: 'encrypt', params: { contactIds } }],
      });
      expect(res.statusCode, res.body).toBe(201);
      await (app.conbert.workflows.queue as unknown as { idle(): Promise<void> }).idle();
      const runId = res.json<{ run: WorkflowRunDto }>().run.id;
      return (await call(cookie, 'GET', `/api/workflow-runs/${runId}`)).json<{
        run: WorkflowRunDto;
      }>().run;
    };

    const run = await runFor(admin, [contact.id]);
    expect(run.files[0], JSON.stringify(run)).toMatchObject({ status: 'done' });
    const content = await call(admin, 'GET', `/api/files/${run.files[0]?.resultFileId}/content`);
    const d = new Decrypter();
    d.addIdentity(anna.identity);
    expect(Buffer.from(await d.decrypt(new Uint8Array(content.rawPayload)))).toEqual(
      readFileSync(path.join(fixtures, 'sample.png')),
    );

    // Bea can't borrow the admin's contact by its ID.
    const bea = await secondUser();
    const beaRun = await runFor(bea.cookie, [contact.id]);
    expect(beaRun.files[0]?.error?.messageKey).toBe('errors.keyNoRecipients');
  });
});

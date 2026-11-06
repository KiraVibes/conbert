import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { request, type FullConfig } from '@playwright/test';
import { E2E_DEFAULTS } from './defaults';

/**
 * Signs in once for all tests: runs the first-start setup on a fresh
 * instance, otherwise logs in. The session cookie is saved as storage state.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('no baseURL');
  const statePath = path.resolve(import.meta.dirname, '.auth/state.json');
  mkdirSync(path.dirname(statePath), { recursive: true });

  const username = process.env['E2E_USER'] ?? E2E_DEFAULTS.username;
  const password = process.env['E2E_PASSWORD'] ?? E2E_DEFAULTS.password;
  const setupCode = process.env['E2E_SETUP_CODE'] ?? E2E_DEFAULTS.setupCode;

  const api = await request.newContext({ baseURL });
  const status = (await (await api.get('/api/auth/status')).json()) as { setupRequired: boolean };
  const res = status.setupRequired
    ? await api.post('/api/auth/setup', {
        data: { mode: 'local', setupCode, username, password },
      })
    : await api.post('/api/auth/login', { data: { username, password } });
  if (!res.ok()) {
    throw new Error(
      `E2E sign-in failed (${res.status()}): ${await res.text()} – set E2E_SETUP_CODE or E2E_USER/E2E_PASSWORD`,
    );
  }
  // German UI for all tests, regardless of earlier settings.
  await api.put('/api/settings', {
    data: { settings: { language: 'de', expertMode: false, tourSeen: true } },
  });
  await api.storageState({ path: statePath });
  await api.dispose();
}

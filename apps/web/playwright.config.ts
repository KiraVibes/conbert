import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_DEFAULTS } from './e2e/defaults';

/**
 * By default the tests start their own server (fresh data folder, own
 * queue name, fixed setup code) plus the Vite dev server on separate ports,
 * so a running `pnpm dev` is not disturbed.
 *
 * To test a running build instead, e.g. the Docker container:
 *   E2E_BASE_URL=http://localhost:3313 E2E_SETUP_CODE=<code from the log> pnpm test:e2e
 * (or E2E_USER / E2E_PASSWORD if it is already set up).
 */
const external = process.env['E2E_BASE_URL'];
const SERVER_PORT = 3323;
const WEB_PORT = 3324;

const dataDir = path.join(os.tmpdir(), `conbert-e2e-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: external ?? `http://localhost:${WEB_PORT}`,
    locale: 'de-DE',
    trace: 'retain-on-failure',
    storageState: './e2e/.auth/state.json',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(external
    ? {}
    : {
        webServer: [
          {
            command: 'pnpm --filter @conbert/server dev',
            cwd: repoRoot,
            port: SERVER_PORT,
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
              CONBERT_PORT: String(SERVER_PORT),
              CONBERT_DATA_DIR: dataDir,
              CONBERT_SETUP_CODE: E2E_DEFAULTS.setupCode,
              CONBERT_QUEUE_NAME: `conbert-e2e-${Date.now()}`,
              CONBERT_LOG_LEVEL: 'warn',
            },
          },
          {
            command: 'pnpm run dev',
            port: WEB_PORT,
            reuseExistingServer: false,
            timeout: 120_000,
            env: { CONBERT_PORT: String(SERVER_PORT), CONBERT_WEB_PORT: String(WEB_PORT) },
          },
        ],
      }),
});

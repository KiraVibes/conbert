import { expect, test } from '@playwright/test';

// Own browser state: the second user signs in here, the shared admin session stays.
test.use({ storageState: { cookies: [], origins: [] } });

const MEMBER = { username: 'e2e-permissions', password: 'e2e permissions password' };

test('a function blocked for everyone disappears for normal users', async ({
  page,
  playwright,
}) => {
  // The admin (shared session from global setup) blocks the downloader for everyone.
  const api = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: './e2e/.auth/state.json',
  });
  const created = await api.post('/api/users', { data: MEMBER });
  expect([201, 409]).toContain(created.status());
  const blocked = await api.patch('/api/groups/everyone', {
    data: { permissions: { downloader: false } },
  });
  expect(blocked.ok()).toBe(true);

  try {
    await page.goto('/');
    await page.getByLabel('Benutzername').fill(MEMBER.username);
    await page.getByLabel('Passwort', { exact: true }).fill(MEMBER.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    const nav = page.getByRole('navigation', { name: 'Was möchtest du tun?' });
    await expect(nav.getByRole('button', { name: 'Umwandeln' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Herunterladen' })).toHaveCount(0);

    await page.goto('/#/download');
    await expect(page.getByText('Diese Funktion ist für dich gesperrt')).toBeVisible();
    expect((await page.request.get('/api/downloader/jobs')).status()).toBe(403);
  } finally {
    await api.patch('/api/groups/everyone', { data: { permissions: {} } });
    await api.dispose();
  }
});

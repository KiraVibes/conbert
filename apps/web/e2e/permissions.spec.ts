import { expect, test } from '@playwright/test';

// Own browser state: the second user signs in here, the shared admin session stays.
test.use({ storageState: { cookies: [], origins: [] } });

const MEMBER = { username: 'e2e-permissions', password: 'e2e permissions password' };

test('a group that blocks a function hides it from its members', async ({ page, playwright }) => {
  // The admin (shared session from global setup) puts the user into a group without the downloader.
  const api = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: './e2e/.auth/state.json',
  });
  const created = await api.post('/api/users', { data: MEMBER });
  expect([201, 409]).toContain(created.status());
  const users = (await (await api.get('/api/users')).json()) as {
    users: { id: string; username: string }[];
  };
  const member = users.users.find((u) => u.username === MEMBER.username);
  expect(member).toBeDefined();
  const group = await api.post('/api/groups', {
    data: { name: `e2e-no-download-${Date.now()}`, permissions: { downloader: false } },
  });
  expect(group.status()).toBe(201);
  const { group: dto } = (await group.json()) as { group: { id: string } };
  await api.put(`/api/groups/${dto.id}/members`, { data: { userIds: [member?.id] } });

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
    await api.delete(`/api/groups/${dto.id}`);
    await api.dispose();
  }
});

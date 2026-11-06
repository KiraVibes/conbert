import { expect, test } from '@playwright/test';
import { E2E_DEFAULTS } from './defaults';

// Own, signed-out browser state: signing out here must not end the shared
// session the other tests use.
test.use({ storageState: { cookies: [], origins: [] } });

const username = process.env['E2E_USER'] ?? E2E_DEFAULTS.username;
const password = process.env['E2E_PASSWORD'] ?? E2E_DEFAULTS.password;

test('signing in and out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Melde dich mit deinem Conbert-Konto an.')).toBeVisible();

  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort', { exact: true }).fill('definitely wrong');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText('Anmeldung fehlgeschlagen.')).toBeVisible();

  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText('Dateien hierher ziehen')).toBeVisible();

  await page.getByRole('button', { name: /^Konto von/ }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page.getByLabel('Benutzername')).toBeVisible();
});

import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Offline use through the service worker. It only exists in a production
 * build, so these tests run against a built instance (E2E_BASE_URL).
 */
test.skip(!process.env['E2E_BASE_URL'], 'The service worker only runs in a production build');

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

/** Opens the app and waits until the service worker controls the page. */
async function openWithServiceWorker(page: Page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function convertToWebp(page: Page) {
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  return card;
}

test('a tool that was never stored says so offline instead of loading forever', async ({
  page,
  context,
}) => {
  await openWithServiceWorker(page);
  await context.setOffline(true);
  await page.reload();

  const card = await convertToWebp(page);
  // Shown once – the file card doesn't repeat the conversion's own error.
  await expect(card.getByText('nicht für die Offline-Nutzung gespeichert')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(card.getByText(/Für offline vorbereiten/)).toBeVisible();
});

test('after "prepare for offline" converting works without a connection', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await openWithServiceWorker(page);
  await page.goto('/#/settings');
  await page.getByRole('button', { name: /Für offline vorbereiten/ }).click();
  await expect(page.getByText(/Alles gespeichert/)).toBeVisible({ timeout: 180_000 });

  await context.setOffline(true);
  await page.goto('/');
  const card = await convertToWebp(page);
  await expect(card.getByRole('link', { name: 'Herunterladen' })).toBeVisible({ timeout: 30_000 });
});

test('the installed app offers to prepare for offline, "Not now" hides it for good', async ({
  page,
}) => {
  // Pretend to run from the home screen.
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes('display-mode: standalone')
        ? ({ ...original(query), matches: true, media: query } as MediaQueryList)
        : original(query);
  });
  await openWithServiceWorker(page);
  await page.evaluate(() => localStorage.removeItem('conbert.offlineHintDismissed'));
  await page.reload();

  const hint = page.getByRole('region', { name: 'Conbert auch ohne Internet nutzen' });
  await expect(hint).toBeVisible();
  await expect(hint.getByRole('button', { name: /Für offline vorbereiten/ })).toBeVisible();
  await hint.getByRole('button', { name: 'Nicht jetzt' }).click();
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(page.getByText('Dateien hierher ziehen')).toBeVisible();
  await expect(hint).toBeHidden();
});

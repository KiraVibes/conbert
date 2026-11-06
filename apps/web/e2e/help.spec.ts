import path from 'node:path';
import { expect, test } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

test('the "?" link of a view opens its help article', async ({ page }) => {
  await page.goto('/#/compress');
  await page.getByRole('link', { name: 'Hilfe zu diesem Bereich' }).click();
  await expect(page).toHaveURL(/#\/help\/compress$/);
  await expect(page.getByRole('heading', { name: 'Hilfe', level: 1 })).toBeVisible();
  const article = page.locator('#help-area-compress');
  await expect(article).toHaveAttribute('open', '');
  await expect(article.getByText(/Mach eine Datei kleiner/)).toBeVisible();
});

test('the glossary can be searched', async ({ page }) => {
  await page.goto('/#/help');
  const search = page.getByRole('searchbox', { name: 'Begriff suchen' });
  await search.fill('codec');
  await expect(page.getByText('Codec', { exact: true })).toBeVisible();
  await expect(page.getByText('Polygon', { exact: true })).toHaveCount(0);
});

test('the tour can be restarted from the help page and walks through to the end', async ({
  page,
}) => {
  await page.goto('/#/help');
  await page.getByRole('button', { name: 'Rundgang starten' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Willkommen bei Conbert!');
  for (let i = 0; i < 6; i++) await dialog.getByRole('button', { name: 'Weiter' }).click();
  await expect(dialog).toContainText('Hilfe, wenn du sie brauchst');
  await dialog.getByRole('button', { name: "Los geht's" }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Dateien hierher ziehen')).toBeVisible();
});

test('the purpose assistant sets up a picture for WhatsApp and converts it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  await expect(card.getByText('PNG-Bild')).toBeVisible();

  await page.getByRole('button', { name: /Für WhatsApp/ }).click();
  await expect(card.getByRole('combobox', { name: 'Umwandeln in' })).toContainText('JPEG-Bild');
  await expect(card.getByText(/JPG öffnet jedes Handy/)).toBeVisible();

  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.jpg');
});

test('without a server, converting on this device still works', async ({ page }) => {
  // The server is down: every API call fails.
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByText('Keine Verbindung zum Server')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  await expect(card.getByRole('link', { name: 'Herunterladen' })).toBeVisible({ timeout: 30_000 });
});

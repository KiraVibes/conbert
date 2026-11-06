import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

async function convertLocally(page: Page, file: string, target: RegExp) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  const card = page.getByTestId('file-card');
  await card.getByRole('radio', { name: 'Auf diesem Gerät' }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: target }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const link = card.getByRole('link', { name: 'Herunterladen' });
  await expect(link.or(card.getByRole('alert'))).toBeVisible({ timeout: 60_000 });
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

async function openPreview(page: Page, file: string) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  await page
    .getByTestId('file-card')
    .getByRole('button', { name: /Vorschau von/ })
    .click();
  return page.getByRole('dialog');
}

test('turns a German CSV into an Excel file in the browser', async ({ page }) => {
  const { name, bytes } = await convertLocally(page, 'sample.csv', /^Excel-Tabelle Tabelle/);
  expect(name).toBe('sample.xlsx');
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});

test('turns YAML into JSON in the browser', async ({ page }) => {
  const { bytes } = await convertLocally(page, 'sample.yaml', /JSON-Daten/);
  expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({ server: { port: 3313 } });
});

test('repacks a 7Z archive as ZIP in the browser', async ({ page }) => {
  const { bytes } = await convertLocally(page, 'sample.7z', /ZIP-Archiv/);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(bytes.toString('latin1')).toContain('hallo.txt');
});

test('saves a PDF page as PNG in the browser', async ({ page }) => {
  const { bytes } = await convertLocally(page, 'sample.pdf', /PNG-Bild/);
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
});

test('previews an archive as a file list', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.zip');
  const preview = dialog.getByTestId('archive-preview');
  await expect(preview).toContainText('hallo.txt', { timeout: 30_000 });
  await expect(preview).toContainText('zwei.txt');
});

test('previews a font with a sample text', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.woff2');
  await expect(dialog.getByTestId('font-preview')).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel('Eigener Beispieltext').fill('Conbert');
  await expect(dialog.getByTestId('font-preview')).toContainText('Conbert');
});

test('previews a spreadsheet as a table', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.xlsx');
  const table = dialog.getByTestId('table-preview');
  await expect(table.getByRole('columnheader', { name: 'Stadt' })).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole('cell', { name: 'München' })).toBeVisible();
});

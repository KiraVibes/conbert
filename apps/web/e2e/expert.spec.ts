import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

const setExpert = (request: APIRequestContext, expertMode: boolean) =>
  request.put('/api/settings', {
    data: { settings: { language: 'de', expertMode, tourSeen: true } },
  });

async function expertCard(page: Page, file: string, target: RegExp) {
  await setExpert(page.request, true);
  await page.goto('/');
  await expect(page.getByRole('switch', { name: 'Experte' })).toBeChecked();
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  const card = page.getByTestId('file-card');
  await card.getByRole('radio', { name: 'Auf diesem Gerät' }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: target }).click();
  return card;
}

// Back to simple mode for the other tests.
test.afterEach(async ({ request }) => {
  await setExpert(request, false);
});

test('"lossless" puts the quality at 100 and locks it', async ({ page }) => {
  const card = await expertCard(page, 'sample.png', /WebP-Bild/);
  const quality = card.getByRole('slider', { name: 'Qualität' });
  await expect(quality).toHaveAttribute('aria-valuenow', '80');
  await card.getByRole('switch', { name: 'Verlustfrei' }).click();
  await expect(quality).toHaveAttribute('aria-valuenow', '100');
  await expect(quality).toHaveAttribute('data-disabled', '');
  await expect(card.getByText('Fest eingestellt, solange „Verlustfrei“ an ist.')).toBeVisible();
  await card.getByRole('switch', { name: 'Verlustfrei' }).click();
  await expect(quality).toHaveAttribute('aria-valuenow', '80');
});

test('reads metadata and writes changes into the result', async ({ page }) => {
  const card = await expertCard(page, 'sample.jpg', /PNG-Bild/);
  await card.getByRole('tab', { name: 'Metadaten' }).click();
  const panel = card.getByTestId('metadata-panel');
  // The first time, ExifTool (WebAssembly, ~25 MB) is loaded.
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await panel.getByRole('textbox', { name: 'Titel', exact: true }).fill('Sonnenuntergang');
  await panel.getByRole('textbox', { name: 'Urheber', exact: true }).fill('Anna Beispiel');
  await panel.getByText(/Alle Metadaten anzeigen/).click();
  await expect(panel.getByRole('table').first()).toBeVisible();

  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  await expect(card.getByText('Metadaten wurden in die Datei geschrieben.')).toBeVisible({
    timeout: 60_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('link', { name: 'Herunterladen' }).click(),
  ]);
  const bytes = readFileSync(await download.path()).toString('latin1');
  expect(bytes.slice(1, 4)).toBe('PNG');
  expect(bytes).toContain('Sonnenuntergang');
  expect(bytes).toContain('Anna Beispiel');
});

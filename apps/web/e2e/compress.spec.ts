import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

/** A noisy photo-like JPEG at maximum quality – plenty to compress. */
function bigJpegPath(): string {
  return path.resolve(import.meta.dirname, '../test-results/big.jpg');
}

async function addToCompress(page: Page, file: string) {
  await page.goto('/#/compress');
  await expect(page.getByRole('button', { name: 'Komprimieren', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByTestId('file-input').setInputFiles(file);
  return page.getByTestId('compress-card');
}

test.beforeAll(async ({ browser }) => {
  // Build a 1200 × 900 noisy JPEG at quality 100 in the browser itself.
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1200, 900);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const img = ctx.createImageData(1200, 900);
    for (let i = 0; i < img.data.length; i += 4) {
      const x = (i / 4) % 1200;
      img.data[i] = (x / 5 + Math.random() * 60) & 255;
      img.data[i + 1] = (i / 4 / 1200 / 4 + Math.random() * 60) & 255;
      img.data[i + 2] = 128 + Math.random() * 60;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1 });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  writeFileSync(bigJpegPath(), Buffer.from(bytes));
  await page.close();
});

test('compresses a photo in the same format and shows the savings', async ({ page }) => {
  const card = await addToCompress(page, bigJpegPath());
  await expect(card.getByRole('combobox', { name: 'Format' })).toContainText('JPEG');
  await card.getByRole('radio', { name: 'Ausgewogen' }).click();
  await card.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  await expect(card.getByText(/% gespart/)).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('link', { name: 'Herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('big.jpg');
  const original = readFileSync(bigJpegPath()).length;
  expect(readFileSync(await download.path()).length).toBeLessThan(original / 2);
});

test('hits a target size', async ({ page }) => {
  const card = await addToCompress(page, bigJpegPath());
  await card.getByRole('radio', { name: 'Zielgröße' }).click();
  await card.getByRole('spinbutton', { name: 'Zielgröße in MB' }).fill('0.2');
  await card.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  await expect(card.getByText(/% gespart/)).toBeVisible({ timeout: 90_000 });
  await expect(card.getByText(/Zielgröße wurde nicht ganz erreicht/)).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('link', { name: 'Herunterladen' }).click(),
  ]);
  expect(readFileSync(await download.path()).length).toBeLessThanOrEqual(0.2 * 1024 * 1024);
});

test('compresses music and lists files separately from "Umwandeln"', async ({ page }) => {
  const card = await addToCompress(page, fixture('sample.wav'));
  // WAV can't shrink in place – a smaller format is suggested.
  await expect(card.getByRole('combobox', { name: 'Format' })).toContainText(/MP3|M4A|Opus/);
  await card.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  await expect(card.getByText(/% gespart/)).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  await expect(page.getByTestId('compress-card')).toHaveCount(0);
  await expect(page.getByTestId('file-card')).toHaveCount(0);
});

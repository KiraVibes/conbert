import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const MB = 1024 * 1024;

/** 2.5 MB of a repeating pattern – the joined file must match it byte for byte. */
const original = Buffer.alloc(2.5 * MB);
for (let i = 0; i < original.length; i++) original[i] = (i * 31) & 255;

test('splits a file into parts and joins them again', async ({ page }) => {
  await page.goto('/#/workshop/split');
  const split = page.getByRole('tabpanel', { name: 'Teilen' });
  await split
    .getByTestId('file-input')
    .setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: original });
  const size = split.getByRole('textbox', { name: 'Größe pro Teil' });
  await size.fill('1');
  await size.press('Enter');
  await expect(split.getByText('3 Teile')).toBeVisible();

  const parts = new Map<string, Buffer>();
  for (const name of ['big.bin.001', 'big.bin.002', 'big.bin.003']) {
    const download = page.waitForEvent('download');
    await split.getByRole('button', { name: `${name} speichern` }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(name);
    parts.set(name, readFileSync(await file.path()));
  }
  expect([...parts.values()].map((b) => b.length)).toEqual([MB, MB, MB / 2]);
  const part = (name: string) => ({
    name,
    mimeType: 'application/octet-stream',
    buffer: parts.get(name) ?? Buffer.alloc(0),
  });

  await page.getByRole('tab', { name: 'Zusammensetzen' }).click();
  const join = page.getByRole('tabpanel', { name: 'Zusammensetzen' });
  // Missing middle part: explained, nothing to save.
  await join.getByTestId('file-input').setInputFiles([part('big.bin.003'), part('big.bin.001')]);
  await expect(join.getByRole('alert')).toContainText('Teil 002');
  await join.getByTestId('file-input').setInputFiles([part('big.bin.002')]);
  const download = page.waitForEvent('download');
  await join.getByRole('button', { name: '„big.bin“ speichern' }).click();
  const joined = readFileSync(await (await download).path());
  expect(joined.equals(original)).toBe(true);
});

test('compresses an SVG from a drawing program', async ({ page }) => {
  await page.goto('/#/compress');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Created with a drawing program -->
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <metadata>notes</metadata>
  <circle cx="50.000000123" cy="49.99999987" r="40.123456789" fill="#ff0000"/>
</svg>`;
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  const card = page.getByTestId('compress-card');
  await expect(card).toContainText('SVG-Vektorgrafik');
  await card.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  await expect(card).toContainText('gespart', { timeout: 30_000 });
});

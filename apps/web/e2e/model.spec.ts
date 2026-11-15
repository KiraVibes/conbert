import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

async function convertLocally(page: Page, file: string, target: RegExp) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  const card = page.getByTestId('file-card');
  await card.getByText('Auf diesem Gerät', { exact: true }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: target }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const link = card.getByRole('link', { name: 'Herunterladen' });
  await expect(link.or(card.getByRole('alert'))).toBeVisible({ timeout: 60_000 });
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  return readFileSync(await download.path());
}

test('converts OBJ to GLB in the browser', async ({ page }) => {
  const glb = await convertLocally(page, 'sample.obj', /GLB \(glTF binär\)/);
  expect(glb.subarray(0, 4).toString('ascii')).toBe('glTF');
});

test('converts FBX to STL in the browser', async ({ page }) => {
  const stl = await convertLocally(page, 'sample.fbx', /STL/);
  // Binary STL: 80-byte header, then the triangle count (a cube has 12).
  expect(stl.readUInt32LE(80)).toBe(12);
});

test('shows a 3D model with triangle count and wireframe', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.dae'));
  await page
    .getByTestId('file-card')
    .getByRole('button', { name: /Vorschau von/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('model-stats')).toContainText('12 Dreiecke', { timeout: 30_000 });
  await expect(dialog.getByTestId('model-preview').locator('canvas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Drahtgitter' }).click();
  await expect(dialog.getByRole('button', { name: 'Drahtgitter' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('compresses a GLB with Meshopt in the browser', async ({ page }) => {
  await page.goto('/#/compress');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.glb'));
  const card = page.getByTestId('compress-card');
  // Every format can aim for a target size now, 3D models too.
  await expect(card.getByRole('radio', { name: 'Zielgröße' })).toBeVisible();
  await card.getByRole('radio', { name: 'Auf diesem Gerät' }).click();
  await card.getByRole('radio', { name: 'Ausgewogen' }).click();
  await card.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  await expect(card.getByText(/% gespart|unverändert behalten/)).toBeVisible({ timeout: 60_000 });
});

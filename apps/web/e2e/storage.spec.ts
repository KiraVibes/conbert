import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

/** A file name far longer than any dialog is wide. */
const LONG_NAME =
  'ACFrOgDre9qY_4REiAEUKgy_BsTN1CLoWeAEZ7WnblL3wb84e2XA37F28hRgbjV7DzR5g1cRmT0_sehr_langer_Name';

/** Converts sample.png (renamed) to WebP on this device; returns its card. */
async function convertPicture(page: Page, newName?: string) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  if (newName) {
    await card.getByRole('button', { name: '„sample.png“ umbenennen' }).click();
    const input = card.getByRole('textbox', { name: 'Neuer Dateiname (ohne Endung)' });
    await input.fill(newName);
    await input.press('Enter');
  }
  await card.getByRole('radio', { name: 'Auf diesem Gerät' }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  await expect(card.getByRole('link', { name: 'Herunterladen' })).toBeVisible({ timeout: 30_000 });
  return card;
}

/** The dialog must never get wider than the window (long file names!). */
async function expectFitsWindow(page: Page) {
  const box = await page.getByRole('dialog').boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box && box.x >= 0 && box.x + box.width <= width + 1, JSON.stringify(box)).toBe(true);
}

/**
 * Storage locations end to end: set one up with the wizard (incl. a new
 * folder), save a result there, open it again and save automatically. Uses a
 * "folder on the server" – the Docker test mounts a volume at /storage.
 */
test('saves results to a storage location and opens them from there', async ({ page, request }) => {
  const roots = (await (await request.get('/api/targets/roots')).json()) as { roots: string[] };
  test.skip(roots.roots.length === 0, 'needs a mounted /storage folder (Docker test)');
  const stamp = Date.now();
  const name = `E2E-Ablage ${stamp}`;
  const folder = `E2E-Ordner-${stamp}`;

  // 1. Set up the location with the wizard, in a folder made right there.
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Speicherort hinzufügen' }).click();
  const wizard = page.getByRole('dialog');
  await wizard.getByRole('radio', { name: /Ordner auf dem Server/ }).click();
  await wizard.getByRole('combobox', { name: /Eingebundener Ordner/ }).click();
  await page.getByRole('option', { name: roots.roots[0] }).click();
  await wizard.getByRole('button', { name: 'Verbindung testen' }).click();
  await expect(wizard.getByText('Verbindung klappt!')).toBeVisible({ timeout: 30_000 });
  await wizard.getByRole('button', { name: 'Weiter' }).click();
  await wizard.getByRole('button', { name: 'Neuer Ordner' }).click();
  const folderName = wizard.getByRole('textbox', { name: 'Name des neuen Ordners' });
  await folderName.fill(folder);
  await folderName.press('Enter');
  await expect(wizard.getByText(`/${folder}`, { exact: true })).toBeVisible();
  await wizard.getByLabel('Name').fill(name);
  await wizard.getByRole('button', { name: 'Speichern' }).click();
  await expect(wizard).toBeHidden();
  const row = page.getByTestId('storage-target').filter({ hasText: name });
  await expect(row).toContainText(`/${folder}`);

  // 2. Save a result with a very long name there.
  let card = await convertPicture(page, LONG_NAME);
  await card.getByRole('button', { name: /auf einem Speicherort speichern/ }).click();
  const save = page.getByRole('dialog');
  await expect(save.getByText(/über deinen Server übertragen/)).toBeVisible();
  await save.getByRole('checkbox', { name }).check();
  await save.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText(`Gespeichert auf ${name}.`).first()).toBeVisible({
    timeout: 30_000,
  });
  // Saved = done with it: the card leaves the list (like after a download).
  await expect(card).toHaveCount(0);

  // 3. Open it again – the long name must not stretch the dialog.
  await page.getByRole('button', { name: 'Von Speicherort öffnen' }).click();
  const open = page.getByRole('dialog');
  const picker = open.getByRole('combobox', { name: 'Speicherort' });
  if (await picker.isVisible()) {
    await picker.click();
    await page.getByRole('option', { name }).click();
  }
  const entry = open.getByRole('checkbox', { name: new RegExp(LONG_NAME) });
  await expect(entry).toBeVisible();
  await expectFitsWindow(page);
  // Clicking a file shows it right away (and ticks it).
  await expect(open.getByText('Klicke auf eine Datei, um sie hier anzusehen.')).toBeVisible();
  await entry.check();
  await expect(open.getByTestId('storage-preview').getByRole('img')).toBeVisible({
    timeout: 30_000,
  });
  await expectFitsWindow(page);
  await open.getByRole('button', { name: '1 Datei öffnen' }).click();
  await expect(page.getByTestId('file-card')).toContainText('WebP-Bild', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Alle entfernen' }).click();

  // 4. Save every conversion automatically.
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: 'Jede Umwandlung automatisch speichern' }).click();
  await page.getByRole('option', { name }).click();
  card = await convertPicture(page);
  await expect(card.getByText(`Automatisch gespeichert auf „${name}“: sample.webp`)).toBeVisible({
    timeout: 30_000,
  });

  // 5. Clean up: removing the location also switches automatic saving off.
  await page.goto('/#/settings');
  await row.getByRole('button', { name: 'Entfernen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Entfernen' }).click();
  await expect(row).toHaveCount(0);
});

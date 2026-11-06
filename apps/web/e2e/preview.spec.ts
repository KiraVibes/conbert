import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

async function openPreview(page: Page, file: string) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  const card = page.getByTestId('file-card');
  await card.getByRole('button', { name: /Vorschau von/ }).click();
  return page.getByRole('dialog');
}

test('shows a picture with zoom', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.png');
  await expect(dialog.getByTestId('image-preview').locator('img')).toBeVisible();
  await dialog.getByRole('button', { name: 'Vergrößern' }).click();
  await expect(dialog.getByText('150 %')).toBeVisible();
});

test('converts an iPhone photo (HEIC) for the preview', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.heic');
  const img = dialog.getByTestId('image-preview').locator('img');
  await expect(img).toBeVisible({ timeout: 60_000 });
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test('plays audio with a waveform', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.mp3');
  await expect(dialog.getByTestId('audio-preview').locator('audio')).toBeVisible();
  // The player has loaded the sound (not 0:00).
  await expect
    .poll(() =>
      dialog
        .getByTestId('audio-preview')
        .locator('audio')
        .evaluate((el: HTMLAudioElement) => el.duration),
    )
    .toBeGreaterThan(0);
  // wavesurfer draws into a shadow DOM inside the container.
  await expect
    .poll(() =>
      dialog
        .getByTestId('audio-preview')
        .evaluate(
          (el) =>
            (el.firstElementChild as HTMLElement | null)?.shadowRoot?.querySelector('canvas') !==
            null,
        ),
    )
    .toBe(true);
});

test('shows a video with a strip of stills', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.mp4');
  await expect(dialog.getByTestId('video-preview').locator('video')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Zu Sekunde/ }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test('renders PDF pages', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.pdf');
  await expect(dialog.getByText('Seite 1 von 2')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Nächste Seite' }).click();
  await expect(dialog.getByText('Seite 2 von 2')).toBeVisible();
});

test('shows a Word document as HTML in a sandbox', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.docx');
  const frame = dialog.getByTestId('html-preview');
  await expect(frame).toBeVisible({ timeout: 90_000 });
  expect(await frame.getAttribute('sandbox')).toBe('');
  await expect(frame.contentFrame().getByText(/Conbert Testdokument/)).toBeVisible();
});

test('highlights Markdown and can render it', async ({ page }) => {
  const dialog = await openPreview(page, 'sample.md');
  await expect(dialog.getByTestId('text-preview')).toContainText('Conbert Testdokument');
  await dialog.getByRole('button', { name: 'Als Dokument anzeigen' }).click();
  await expect(dialog.getByTestId('html-preview')).toBeVisible({ timeout: 90_000 });
});

test('compares before and after with a slider', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page
    .getByRole('option', { name: /JPG-Bild|JPEG/ })
    .first()
    .click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  await card.getByRole('button', { name: 'Vorschau', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Vergleich' }).click();
  const slider = dialog.getByRole('slider', { name: /Trennlinie/ });
  await expect(slider).toBeVisible();
  await slider.fill('20');
  await expect(dialog.getByTestId('compare-preview').locator('img').nth(1)).toHaveAttribute(
    'style',
    /inset\(0px 0px 0px 20%\)|inset\(0 0 0 20%\)/,
  );
});

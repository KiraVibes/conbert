import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

test('the page is cross-origin isolated (needed for WASM engines)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Dateien hierher ziehen')).toBeVisible();
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});

test('converts a PNG to WebP locally and offers the download', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));

  const card = page.getByTestId('file-card');
  await expect(card.getByText('PNG-Bild')).toBeVisible();

  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await expect(card.getByText(/am privatesten/)).toBeVisible();

  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink).toBeVisible({ timeout: 30_000 });

  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.webp');
  const saved = await download.path();
  const bytes = readFileSync(saved);
  // WebP files start with "RIFF....WEBP".
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
});

test('expert mode reveals advanced options with explanations', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();

  await expect(card.getByText('Qualität', { exact: true })).toBeVisible();
  await expect(card.getByText('Metadaten entfernen', { exact: true })).toHaveCount(0);

  await page.getByRole('switch').first().click();
  await expect(card.getByText('Metadaten entfernen', { exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Erklärung zu „Metadaten entfernen“ anzeigen' }).click();
  await expect(page.getByText(/GPS-Standort/)).toBeVisible();
});

test('downloads all results at once as a ZIP', async ({ page }) => {
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles([fixture('sample.png'), fixture('sample.jpg')]);
  await expect(page.getByTestId('file-card')).toHaveCount(2);

  await page.getByRole('combobox', { name: 'Alle umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await page.getByRole('button', { name: 'Alle umwandeln', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Herunterladen' })).toHaveCount(2, {
    timeout: 30_000,
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Alle 2 herunterladen (ZIP)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^conbert-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  // Both files are called "sample.webp" – the second one gets a number.
  expect(Object.keys(files).sort()).toEqual(['sample (2).webp', 'sample.webp']);
});

test('converts an iPhone photo (HEIC) to JPG right in the browser', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.heic'));
  const card = page.getByTestId('file-card');
  await expect(card.getByText('HEIC-Foto')).toBeVisible();
  await card.getByText('Auf diesem Gerät', { exact: true }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /JPEG-Bild/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink.or(card.getByRole('alert'))).toBeVisible({ timeout: 30_000 });
  // Show the error text instead of a bare timeout if something went wrong.
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.jpg');
  const bytes = readFileSync(await download.path());
  expect(bytes[0]).toBe(0xff);
  expect(bytes[1]).toBe(0xd8);
});

test('extracts the sound of a video locally', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.mp4'));
  const card = page.getByTestId('file-card');
  await expect(card.getByText('MP4-Video')).toBeVisible();
  await card.getByText('Auf diesem Gerät', { exact: true }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /MP3-Audio/ }).click();
  await expect(card.getByText(/nur der Ton übernommen/)).toBeVisible();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink.or(card.getByRole('alert'))).toBeVisible({ timeout: 60_000 });
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.mp3');
  const bytes = readFileSync(await download.path());
  // MP3 starts with an ID3 tag or an MPEG frame sync.
  expect(bytes.subarray(0, 3).toString('ascii') === 'ID3' || bytes[0] === 0xff).toBe(true);
});

// mediabunny (WebCodecs) handles what the browser can encode, ffmpeg.wasm the rest.
const ftyp = [...Buffer.from('ftyp')];
// `fast` = no codec missing in Playwright's Chromium, so ffmpeg.wasm must not be loaded.
for (const [source, target, label, magic, offset, fast] of [
  ['sample.mp4', 'webm', /WebM-Video/, [0x1a, 0x45, 0xdf, 0xa3], 0, false],
  ['sample.mp4', 'gif', /GIF-Bild/, [0x47, 0x49, 0x46], 0, false],
  ['sample.mp4', 'mov', /MOV-Video/, ftyp, 4, true],
  ['sample.mp4', 'm4a', /M4A-Audio/, ftyp, 4, true],
  ['sample.wav', 'ogg', /Ogg-Vorbis/, [...Buffer.from('OggS')], 0, true],
  ['sample.wav', 'mp3', /MP3-Audio/, null, 0, true],
] as const) {
  test(`converts ${source} to ${target} locally`, async ({ page }) => {
    const ffmpegLoads: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('ffmpeg-core')) ffmpegLoads.push(r.url());
    });
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixture(source));
    const card = page.getByTestId('file-card');
    await card.getByText('Auf diesem Gerät', { exact: true }).click();
    await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
    await page.getByRole('option', { name: label }).click();
    await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
    const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
    await expect(downloadLink.or(card.getByRole('alert'))).toBeVisible({ timeout: 90_000 });
    expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const bytes = readFileSync(await download.path());
    if (magic) expect([...bytes.subarray(offset, offset + magic.length)]).toEqual([...magic]);
    else expect(bytes.subarray(0, 3).toString('ascii') === 'ID3' || bytes[0] === 0xff).toBe(true);
    if (fast) expect(ffmpegLoads, 'handled by mediabunny').toEqual([]);
  });
}

test('turns a MIDI file into an MP3 (chain via WAV) locally', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.mid'));
  const card = page.getByTestId('file-card');
  await expect(card.getByText('MIDI-Datei')).toBeVisible();
  await card.getByText('Auf diesem Gerät', { exact: true }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /MP3-Audio/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink.or(card.getByRole('alert'))).toBeVisible({ timeout: 90_000 });
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.mp3');
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 3).toString('ascii') === 'ID3' || bytes[0] === 0xff).toBe(true);
  expect(bytes.byteLength).toBeGreaterThan(10_000);
});

test('converts a soundfont from SF2 to DLS locally', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.sf2'));
  const card = page.getByTestId('file-card');
  await card.getByText('Auf diesem Gerät', { exact: true }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /DLS/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink.or(card.getByRole('alert'))).toBeVisible({ timeout: 30_000 });
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('DLS ');
});

test('converts a Word document to Markdown locally with pandoc-wasm', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.docx'));
  const card = page.getByTestId('file-card');
  await card.getByText('Auf diesem Gerät', { exact: true }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page
    .getByRole('option', { name: /Markdown/ })
    .first()
    .click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  // The first run loads the ~58 MB pandoc WASM.
  await expect(downloadLink.or(card.getByRole('alert'))).toBeVisible({ timeout: 90_000 });
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.md');
  const markdown = readFileSync(await download.path(), 'utf8');
  expect(markdown).toContain('äöü');
});

test('offers only targets that make sense for the file', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await expect(page.getByRole('option', { name: /WebP-Bild/ })).toBeVisible();
  // A picture can't become music or a video.
  await expect(page.getByRole('option', { name: /MP3-Audio/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /MP4-Video/ })).toHaveCount(0);
});

test('renames a file; after the download the card leaves the list', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');

  await card.getByRole('button', { name: '„sample.png“ umbenennen' }).click();
  const nameInput = card.getByRole('textbox', { name: 'Neuer Dateiname (ohne Endung)' });
  await nameInput.fill('Urlaub: Strand');
  await nameInput.press('Enter');
  await expect(card.getByRole('button', { name: '„Urlaub_ Strand.png“ umbenennen' })).toBeVisible();

  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('Urlaub_ Strand.webp');
  await expect(card).toHaveCount(0);

  await page.getByRole('button', { name: 'Archiv öffnen' }).click();
  await expect(page.getByTestId('archive-entry').getByText('Urlaub_ Strand.webp')).toBeVisible();
});

test('the archive keeps every result across reloads until it is removed', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.png'));
  const card = page.getByTestId('file-card');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  // Not downloaded – it still lands in the archive.
  await expect(card.getByRole('link', { name: 'Herunterladen' })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await page.getByRole('button', { name: /^Archiv/ }).click();
  const entry = page.getByTestId('archive-entry');
  await expect(entry.getByText('sample.webp')).toBeVisible();
  await expect(entry.getByText(/Umgewandelt aus „sample.png“/)).toBeVisible();
  const [again] = await Promise.all([
    page.waitForEvent('download'),
    entry.getByRole('button', { name: '„sample.webp“ herunterladen' }).click(),
  ]);
  expect(
    readFileSync(await again.path())
      .subarray(8, 12)
      .toString('ascii'),
  ).toBe('WEBP');

  // Gone from the archive = gone from the list, also after reloading.
  await entry.getByRole('button', { name: /aus dem Archiv entfernen/ }).click();
  await expect(page.getByText(/Noch nichts im Archiv/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Noch nichts im Archiv/)).toBeVisible();
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, '../src/engines/__fixtures__', name);

async function addFile(page: Page, file: string, typeLabel = 'PNG-Bild') {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  const card = page.getByTestId('file-card');
  await expect(card.getByText(typeLabel)).toBeVisible();
  return card;
}

test('converts on the server and shows live progress', async ({ page }) => {
  // The app opens its live connection right at start (workflow notifications),
  // so listen before the page loads.
  const ws = page.waitForEvent('websocket', (socket) => socket.url().endsWith('/api/ws'));
  const card = await addFile(page, 'sample.png');
  await card.getByText('Auf dem Server', { exact: true }).click();
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /WebP-Bild/ }).click();
  await expect(card.getByText('Auf dem Server').nth(1)).toBeVisible();

  await ws;
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();

  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.webp');
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
});

test('"Automatic" uses the server for formats only it can write', async ({ page, request }) => {
  const engines = (await (await request.get('/api/engines')).json()) as {
    engines: { id: string; status: string; formats: { ext: string; canWrite: boolean }[] }[];
  };
  // Vectorizing (vtracer) runs on the server only.
  const vtracer = engines.engines.find((e) => e.id === 'vtracer');
  test.skip(vtracer?.status !== 'ready', 'vtracer is only installed in the Docker image');

  const card = await addFile(page, 'sample.png');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /SVG-Vektorgrafik/ }).click();
  await expect(card.getByText(/kann nur dein Server/)).toBeVisible();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.svg');
  expect(readFileSync(await download.path(), 'utf8')).toContain('<svg');
});

test('turns a video into a Game Boy Advance module', async ({ page, request }) => {
  const engines = (await (await request.get('/api/engines')).json()) as {
    engines: { id: string; status: string }[];
  };
  const gba = engines.engines.find((e) => e.id === 'gba-video');
  test.skip(gba?.status !== 'ready', 'The GBA player is only built in the Docker image');

  const card = await addFile(page, 'sample.mp4', 'MP4-Video');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /GBA-Modul/ }).click();
  await expect(card.getByText('Bildschärfe oder Länge')).toBeVisible();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const downloadLink = card.getByRole('link', { name: 'Herunterladen' });
  await expect(downloadLink).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe('sample.gba');
  const rom = readFileSync(await download.path());
  // Cartridge header: Nintendo logo starts at 0x04, title at 0xA0.
  expect(rom[4]).toBe(0x24);
  expect(rom.subarray(0xa0, 0xa6).toString('ascii')).toBe('SAMPLE');
});

test('compresses on the server', async ({ page, request }) => {
  const engines = (await (await request.get('/api/engines')).json()) as {
    engines: { id: string; status: string }[];
  };
  const ffmpeg = engines.engines.find((e) => e.id === 'ffmpeg-video');
  test.skip(ffmpeg?.status !== 'ready', 'ffmpeg is only installed in the Docker image');

  await page.goto('/#/compress');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.mp4'));
  const card = page.getByTestId('compress-card');
  await card.getByRole('radio', { name: 'Auf dem Server' }).click();
  await card.getByRole('radio', { name: 'Maximal klein' }).click();
  await card.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  // The tiny sample may already be as small as it gets – both outcomes are fine.
  await expect(card.getByText(/% gespart|unverändert behalten/)).toBeVisible({ timeout: 60_000 });
});

test('converts X3D to GLB and compresses with Draco on the server', async ({ page, request }) => {
  const engines = (await (await request.get('/api/engines')).json()) as {
    engines: { id: string; status: string }[];
  };
  const assimp = engines.engines.find((e) => e.id === 'assimp');
  test.skip(assimp?.status !== 'ready', 'assimp is only installed in the Docker image');

  // X3D can only be read on the server – "Automatic" goes there by itself.
  const card = await addFile(page, 'sample.x3d', 'X3D-Modell');
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: /GLB \(glTF binär\)/ }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const link = card.getByRole('link', { name: 'Herunterladen' });
  await expect(link).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(
    readFileSync(await download.path())
      .subarray(0, 4)
      .toString('ascii'),
  ).toBe('glTF');

  await page.goto('/#/compress');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.glb'));
  const compress = page.getByTestId('compress-card');
  await compress.getByRole('radio', { name: 'Maximal klein' }).click();
  await compress.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  await expect(compress.getByText(/% gespart|unverändert behalten/)).toBeVisible({
    timeout: 60_000,
  });
});

async function engineReady(request: APIRequestContext, id: string) {
  const engines = (await (await request.get('/api/engines')).json()) as {
    engines: { id: string; status: string }[];
  };
  return engines.engines.find((e) => e.id === id)?.status === 'ready';
}

async function convertOnServer(page: Page, file: string, typeLabel: string, target: RegExp) {
  const card = await addFile(page, file, typeLabel);
  await card.getByRole('combobox', { name: 'Umwandeln in' }).click();
  await page.getByRole('option', { name: target }).click();
  await card.getByRole('button', { name: 'Umwandeln', exact: true }).click();
  const link = card.getByRole('link', { name: 'Herunterladen' });
  await expect(link.or(card.getByRole('alert'))).toBeVisible({ timeout: 120_000 });
  expect(await card.getByRole('alert').count(), await card.innerText()).toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  return readFileSync(await download.path());
}

test('turns a PowerPoint presentation into a PDF on the server (LibreOffice)', async ({
  page,
  request,
}) => {
  test.skip(
    !(await engineReady(request, 'libreoffice-impress')),
    'LibreOffice is only in the Docker image',
  );
  const pdf = await convertOnServer(
    page,
    'sample.pptx',
    'PowerPoint-Präsentation',
    /^PDF-Dokument/,
  );
  expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
});

test('shrinks a PDF and turns a font into WOFF2 on the server', async ({ page, request }) => {
  test.skip(!(await engineReady(request, 'pdf-tools')), 'Ghostscript is only in the Docker image');
  await page.goto('/#/compress');
  await page.getByTestId('file-input').setInputFiles(fixture('sample.pdf'));
  const card = page.getByTestId('compress-card');
  await card.getByRole('radio', { name: 'Maximal klein' }).click();
  await card.getByRole('button', { name: 'Komprimieren', exact: true }).click();
  await expect(card.getByText(/% gespart|unverändert behalten/)).toBeVisible({ timeout: 60_000 });

  const woff2 = await convertOnServer(page, 'sample.ttf', 'TrueType-Schrift', /^WOFF2-Webschrift/);
  expect(woff2.subarray(0, 4).toString('latin1')).toBe('wOF2');
});

test('turns an EPUB into a Kindle book (full edition only)', async ({ page, request }) => {
  test.skip(!(await engineReady(request, 'calibre')), 'Calibre is only in the "full" edition');
  const mobi = await convertOnServer(page, 'sample.epub', 'EPUB-E-Book', /^Kindle-Buch \(AZW3\)/);
  expect(mobi.subarray(60, 68).toString('latin1')).toBe('BOOKMOBI');
});

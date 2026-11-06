import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('the downloader page explains links it refuses', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Herunterladen' }).click();
  await expect(page.getByText(/Lade nur Inhalte herunter/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Link' }).fill('http://192.168.1.10/video.mp4');
  await page.getByRole('button', { name: 'Prüfen' }).click();
  await expect(page.getByRole('alert')).toContainText('Das ist kein Link, den Conbert laden kann.');
});

test('stores cookies for a platform without ever showing them again', async ({ page }) => {
  const file = path.join(os.tmpdir(), `conbert-e2e-cookies-${Date.now()}.txt`);
  writeFileSync(file, '# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t0\tsid\tgeheim\n');
  await page.goto('/#/settings');
  const row = page.getByTestId('cookie-row').filter({ hasText: 'TikTok' });
  await expect(row).toContainText('keine');
  const chooser = page.waitForEvent('filechooser');
  await row.getByRole('button', { name: 'cookies.txt hochladen: TikTok' }).click();
  await (await chooser).setFiles(file);
  await expect(row).toContainText('gespeichert am');
  await expect(page.getByText('geheim')).toHaveCount(0);
  await row.getByRole('button', { name: 'Löschen: TikTok' }).click();
  await expect(row).toContainText('keine');

  // The guide is right there in the settings (open while no cookies are stored).
  const guide = page.getByTestId('cookie-guide');
  await expect(guide).toContainText('So kommst du an die cookies.txt');
  await expect(guide.getByText(/Get cookies.txt LOCALLY/)).toBeVisible();
});

test('shows the versions of the download tools', async ({ page, request }) => {
  const tools = (await (await request.get('/api/downloader/tools')).json()) as {
    ytDlp: string | null;
  };
  test.skip(tools.ytDlp === null, 'yt-dlp is only installed in the Docker image');
  await page.goto('/#/settings');
  await expect(page.getByText(/^yt-dlp \d{4}\.\d{2}\.\d{2} · gallery-dl \d/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jetzt aktualisieren' })).toBeVisible();
});

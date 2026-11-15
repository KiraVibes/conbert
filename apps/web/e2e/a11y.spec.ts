import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility and phone-width check over every view and every workshop tool:
 * axe (WCAG 2.1 A/AA) in light and dark mode, and no sideways scrolling at 375 px.
 */

const VIEWS = [
  '/',
  '/#/compress',
  '/#/archive',
  '/#/download',
  '/#/booru',
  '/#/workflows',
  '/#/workshop',
  '/#/subscriptions',
  '/#/swipe',
  '/#/pdf',
  '/#/admin',
  '/#/help',
  '/#/settings',
];

interface Finding {
  url: string;
  mode: string;
  rule: string;
  impact: string;
  help: string;
  targets: string[];
}

async function workshopTools(page: Page): Promise<string[]> {
  await page.goto('/#/workshop');
  await expect(page.locator('[data-testid^="favorite-"]').first()).toBeVisible();
  const ids = await page
    .locator('[data-testid^="favorite-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')?.slice(9) ?? ''));
  return [...new Set(ids.filter(Boolean))];
}

async function settle(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  // Let lazy views and animations finish.
  await page.waitForTimeout(300);
}

async function audit(page: Page, url: string, mode: string): Promise<Finding[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations.map((v) => ({
    url,
    mode,
    rule: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} – ${n.failureSummary ?? ''}`),
  }));
}

test('every view passes axe and fits a phone screen', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  // A11Y_ONLY=/#/settings,/#/swipe limits the run while fixing something.
  const only = process.env['A11Y_ONLY']?.split(',');
  const urls =
    only ?? [...VIEWS, ...(await workshopTools(page)).map((id) => `/#/workshop/${id}`)];
  const findings: Finding[] = [];
  const overflow: { url: string; width: number; culprits: string[] }[] = [];

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const url of urls) {
      await settle(page, url);
      findings.push(...(await audit(page, url, scheme)));
    }
  }

  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of urls) {
    await settle(page, url);
    const o = await page.evaluate(() => {
      const width = document.documentElement.scrollWidth;
      const view = document.documentElement.clientWidth;
      const culprits: string[] = [];
      if (width > view)
        for (const el of document.querySelectorAll<HTMLElement>('body *')) {
          const r = el.getBoundingClientRect();
          if (r.right > view + 1 && r.width > 0 && culprits.length < 5) {
            const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
            culprits.push(`${el.tagName.toLowerCase()}.${cls} (${Math.round(r.right)}px)`);
          }
        }
      return { width, view, culprits };
    });
    if (o.width > o.view) overflow.push({ url, width: o.width, culprits: o.culprits });
  }

  const report = process.env['A11Y_REPORT'];
  if (report) writeFileSync(report, JSON.stringify({ findings, overflow }, null, 2));
  expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  expect(overflow, JSON.stringify(overflow, null, 2)).toEqual([]);
});

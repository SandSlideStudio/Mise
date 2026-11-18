import { appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * The accessibility checks: axe-core over the page as it stands.
 *
 * A "serious" or "critical" finding fails the test; those are the ones that
 * stop someone from using a page (text that can't be read, a button with no
 * name). "Moderate" and "minor" are written to a list instead, so they can be
 * looked at without a test going red over a heading level.
 */

export type Theme = 'day' | 'night';
export const THEMES: Theme[] = ['day', 'night'];
export const A11Y_WIDTHS = [
  { label: '1024', viewport: { width: 1024, height: 768 } },
  { label: '390', viewport: { width: 390, height: 844 } },
] as const;

/** Where the moderate and minor findings of a run are listed, one JSON line each. */
export const MINOR_FINDINGS = path.join(
  os.tmpdir(),
  `mise-e2e-axe-minor-${process.env.E2E_PORT ?? '3210'}.jsonl`,
);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Day or night for every page this browser opens, the way the Night button
 * keeps it: in the tablet's own storage, read before the first render.
 */
export async function useTheme(page: Page, theme: Theme) {
  await page.addInitScript((choice) => {
    try {
      window.localStorage.setItem('mise.theme', choice);
    } catch {
      // A page with no storage, such as about:blank, has nothing to keep.
    }
  }, theme);
  // The colours are checked as they finally are, not half way through a fade.
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

/** Switches the page that is open now, without a reload (setup keeps its answers in memory). */
export async function switchTheme(page: Page, theme: Theme) {
  await page.evaluate((choice) => {
    document.documentElement.setAttribute('data-theme', choice);
  }, theme);
  // Buttons fade between colours (transition-colors); check them once they have.
  await page.waitForTimeout(300);
}

export async function expectAccessible(page: Page, where: string) {
  // Fonts change the size of text, and with it what overlaps what.
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  for (const v of results.violations.filter((found) => !blocking.includes(found))) {
    appendFileSync(
      MINOR_FINDINGS,
      `${JSON.stringify({
        where,
        rule: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes.map((node) => node.target.join(' ')).slice(0, 5),
      })}\n`,
    );
  }
  const described = blocking.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help}\n${v.nodes
        .slice(0, 6)
        .map(
          (node) =>
            `    ${node.target.join(' ')}\n      ${node.failureSummary?.split('\n').join(' ')}`,
        )
        .join('\n')}`,
  );
  expect.soft(described, `${where}: accessibility problems\n${described.join('\n')}`).toEqual([]);
}

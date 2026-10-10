import { test as base, expect, type Page } from '@playwright/test';
import type { AppSnapshot, Tab } from '../src/lib/domain';

export const FIXED_NOW = '2026-10-09T12:00:00+08:00';
export const TODAY = '2026-10-09';
export const TOMORROW = '2026-10-10';

/** Each test has its own browser context and local preview account. No real API is involved. */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const apiRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/')) apiRequests.push(request.method());
    });
    testInfo.annotations.push({ type: 'api-mode', description: 'Explicit browser-local mock fixture; no Go API requests are expected.' });
    await page.clock.install({ time: new Date(FIXED_NOW) });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await use(page);
    expect(errors, 'The frontend should not emit uncaught page errors').toEqual([]);
    expect(apiRequests, 'Mock fixture tests must not call the live Go API').toEqual([]);
  }
});

export { expect };

export async function navigate(page: Page, tab: Tab): Promise<void> {
  const label = tab[0].toUpperCase() + tab.slice(1);
  const button = page.getByRole('button', { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

export async function snapshot(page: Page): Promise<AppSnapshot> {
  return page.evaluate(() => {
    const email = window.localStorage.getItem('bodybuilder.preview.active');
    const key = `bodybuilder.preview.account.v1:${encodeURIComponent((email ?? '').toLowerCase())}`;
    const value = window.localStorage.getItem(key);
    if (!value) throw new Error(`No preview snapshot was persisted for ${email}`);
    const saved = JSON.parse(value);
    return saved.snapshot;
  });
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  expect(geometry.document, `Document overflows at ${geometry.viewport}px`).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.body, `Body overflows at ${geometry.viewport}px`).toBeLessThanOrEqual(geometry.viewport + 1);
}

export async function openTodayWorkout(page: Page): Promise<void> {
  await navigate(page, 'workout');
  await page.getByRole('button', { name: 'Get Started', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start Workout', exact: true })).toBeVisible();
}

export async function openCheckIn(page: Page): Promise<void> {
  await navigate(page, 'dashboard');
  await page.getByRole('button', { name: /^Daily Check-in/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

export async function fillCheckIn(page: Page, weight: string, notes: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Weight (kg)', { exact: true }).fill(weight);
  await dialog.getByLabel('Notes', { exact: true }).fill(notes);
  await dialog.getByRole('button', { name: 'Save Check-in', exact: true }).click();
}

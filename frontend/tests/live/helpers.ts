import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import type { AppSnapshot } from '../../src/lib/domain';

export type LiveSnapshot = AppSnapshot & { revision: number };
export type Account = { email: string; password: string; name: string; token: string; userId: string };
export const TEST_PASSWORD = 'BodyBuilder-e2e-42!';

export const test = base.extend<{ app: Page; secondDevice: Page }>({
  app: async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    testInfo.annotations.push({ type: 'api-mode', description: 'Real Go API and PostgreSQL through the same-origin SvelteKit proxy.' });
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await use(page);
    expect(errors, 'The live frontend should not emit uncaught page errors').toEqual([]);
  },
  secondDevice: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({
      baseURL, viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
      locale: 'en-GB', timezoneId: 'Asia/Singapore', colorScheme: 'dark', reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    try { await use(page); }
    finally {
      await context.close();
      expect(errors, 'The second device should not emit uncaught page errors').toEqual([]);
    }
  }
});

export { expect };

export function newEmail(testInfo: TestInfo, purpose: string): string {
  return `bb-${purpose}-${testInfo.project.name}-${randomUUID()}@example.test`;
}

export async function registerAccount(page: Page, testInfo: TestInfo, purpose = 'account'): Promise<Account> {
  const email = newEmail(testInfo, purpose);
  const name = `Test ${purpose}`;
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByLabel('Your name', { exact: true })).toBeVisible();
  await page.getByLabel('Your name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/register' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), 'Public registration must reach the real API').toBe(201);
  const result = await response.json();
  expect(result.success).toBe(true);
  expect(result.data.user.role).toBe('user');
  expect(result.data.user.email).toBe(email);
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  return { email, name, password: TEST_PASSWORD, token: result.data.token, userId: result.data.user.id };
}

export async function signIn(page: Page, account: Pick<Account, 'email' | 'password'>): Promise<string> {
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.success).toBe(true);
  expect(result.data.user.email).toBe(account.email);
  await expect.poll(async () => page.evaluate(() => {
    const session = localStorage.getItem('bodybuilder.live.session');
    return session ? JSON.parse(session).user.id : undefined;
  })).toBe(result.data.user.id);
  // A saved active workout resumes immediately after real authentication.
  await expect.poll(async () =>
    await page.getByRole('button', { name: 'Dashboard', exact: true }).isVisible()
      || await page.getByRole('button', { name: 'Finish', exact: true }).isVisible()
  ).toBe(true);
  return result.data.token;
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account information', exact: true }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
}

export async function currentToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const value = localStorage.getItem('bodybuilder.live.session');
    if (!value) throw new Error('No real authenticated session was persisted');
    const token = JSON.parse(value).token;
    if (!token) throw new Error('The persisted real session has no token');
    return token;
  });
}

export async function backendSnapshot(page: Page, token: string, origin = page.url()): Promise<LiveSnapshot> {
  const response = await page.request.get(new URL('/api/v1/snapshot', origin).toString(), { headers: { authorization: `Bearer ${token}` } });
  expect(response.status(), 'Read the authoritative PostgreSQL snapshot').toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result.success).toBe(true);
  expect(Number.isInteger(result.data.revision)).toBe(true);
  return result.data;
}

export async function backendMutation(page: Page, token: string, state: LiveSnapshot, operation: string, payload: unknown, retryId = randomUUID()) {
  return page.request.post(new URL('/api/v1/mutations', page.url()).toString(), {
    headers: { authorization: `Bearer ${token}` },
    data: { id: retryId, baseRevision: state.revision, operation, payload }
  });
}

export async function navigate(page: Page, tab: string): Promise<void> {
  const button = page.getByRole('button', { name: tab, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
}

export async function today(page: Page): Promise<string> {
  const state = await backendSnapshot(page, await currentToken(page));
  return page.evaluate(timezone => {
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = (type: string) => parts.find(part => part.type === type)!.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }, state.profile.timezone);
}

export async function openCheckIn(page: Page): Promise<void> {
  await navigate(page, 'Dashboard');
  await page.getByRole('button', { name: /^Daily Check-in/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

export async function saveCheckIn(page: Page, weight: string, notes: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Weight (kg)', { exact: true }).fill(weight);
  await dialog.getByLabel('Notes', { exact: true }).fill(notes);
  await dialog.getByRole('button', { name: 'Save Check-in', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

export async function addLesson(page: Page, title: string, notes: string): Promise<void> {
  await navigate(page, 'Lessons');
  await page.getByRole('button', { name: 'Add lesson', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Lesson link', { exact: true }).fill('https://example.com/lesson');
  await dialog.getByLabel('Your notes', { exact: true }).fill(notes);
  await dialog.getByRole('button', { name: 'Save Lesson', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

export async function addManualFood(page: Page, name: string, calories = '125'): Promise<void> {
  await navigate(page, 'Nutrition');
  await page.getByRole('button', { name: 'Add food to Breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Add Food Manually', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Food name', { exact: true }).fill(name);
  await dialog.getByLabel('Serving size', { exact: true }).fill('1 test serving');
  await dialog.getByLabel('Calories', { exact: true }).fill(calories);
  await dialog.getByLabel('Protein (g)', { exact: true }).fill('10');
  await dialog.getByLabel('Carbs (g)', { exact: true }).fill('15');
  await dialog.getByLabel('Fat (g)', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Save Food', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

export async function createAndScheduleTemplate(page: Page, token: string): Promise<void> {
  await navigate(page, 'Workout');
  await page.getByRole('button', { name: 'Choose a Program', exact: true }).click();
  const card = page.getByRole('dialog').locator('article').filter({ has: page.getByRole('heading', { name: '4-Day Upper / Lower', exact: true }) });
  await card.getByRole('button', { name: 'Use Program', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await backendSnapshot(page, token)).programs.length).toBe(1);
  const date = await today(page);
  const weekday = await page.evaluate(date => new Date(`${date}T12:00:00`).toLocaleDateString('en', { weekday: 'short' }), date);
  await page.getByRole('button', { name: `Options for ${weekday} workout`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Upper A', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Get Started', exact: true })).toBeVisible();
}

export async function pendingOperations(page: Page, userId: string): Promise<{ id: string; baseRevision: number; operation: string; payload: unknown }[]> {
  return page.evaluate(async userId => {
    const open = indexedDB.open('bodybuilder.live.v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const request = db.transaction('accounts', 'readonly').objectStore('accounts').get(userId);
      const record = await new Promise<{ outbox: { id: string; baseRevision: number; operation: string; payload: unknown }[] }>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!record) throw new Error('No durable per-user account envelope was stored');
      return record.outbox;
    } finally { db.close(); }
  }, userId);
}

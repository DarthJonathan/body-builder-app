import { test, expect, registerAccount, signIn, signOut, backendSnapshot, navigate, addLesson } from './helpers';
import { assertNoHorizontalOverflow } from '../helpers';

test('public signup creates an empty normal account and real login/logout survive reload', async ({ app }, testInfo) => {
  const account = await registerAccount(app, testInfo, 'signup');
  const initial = await backendSnapshot(app, account.token);
  expect(initial.revision).toBe(0);
  expect(initial.profile.role).toBe('user');
  for (const field of ['programs', 'schedule', 'sessions', 'foodEntries', 'targets', 'checkIns', 'weights', 'lessons'] as const) {
    expect(initial[field], `No preview fixtures should seed ${field}`).toEqual([]);
  }
  for (const tab of ['Lessons', 'Nutrition', 'Dashboard', 'Workout', 'Progress']) {
    await navigate(app, tab);
    await assertNoHorizontalOverflow(app);
  }
  await navigate(app, 'Nutrition');
  await expect(app.getByTestId('calorie-total')).toHaveText('0');
  await signOut(app);
  await app.reload();
  await expect(app.getByLabel('Email', { exact: true })).toBeVisible();
  await app.getByLabel('Email', { exact: true }).fill(account.email);
  await app.getByLabel('Password', { exact: true }).fill('incorrect-test-password');
  const rejected = app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login');
  await app.getByRole('button', { name: 'Sign In', exact: true }).click();
  expect((await rejected).status()).toBe(401);
  await expect(app.getByRole('alert')).toContainText(/password|credentials|incorrect/i);
  await signIn(app, account);
  await app.reload();
  await expect(app.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  expect((await backendSnapshot(app, account.token)).profile.email).toBe(account.email);
});

test('signing into another real account cannot expose cached private records or unsaved drafts', async ({ app, secondDevice }, testInfo) => {
  const first = await registerAccount(app, testInfo, 'private');
  await addLesson(app, 'First account private lesson', 'Keep this private across account transitions.');
  await expect.poll(async () => (await backendSnapshot(app, first.token)).lessons.length).toBe(1);
  await signIn(secondDevice, first);
  await navigate(secondDevice, 'Lessons');
  await expect(secondDevice.locator('button.lesson-main').filter({ hasText: 'First account private lesson' })).toBeVisible();
  await app.locator('button.lesson-main').filter({ hasText: 'First account private lesson' }).click();
  await app.getByRole('dialog').getByLabel('Your notes', { exact: true }).fill('An unsaved private draft');
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await signOut(app);
  const second = await registerAccount(app, testInfo, 'isolated');
  const state = await backendSnapshot(app, second.token);
  expect(state.lessons).toEqual([]);
  expect(state.checkIns).toEqual([]);
  await navigate(app, 'Lessons');
  await expect(app.getByText('First account private lesson', { exact: true })).not.toBeVisible();
  await expect(app.getByText('An unsaved private draft', { exact: true })).not.toBeVisible();
  await app.reload();
  expect((await backendSnapshot(app, second.token)).profile.id).not.toBe(first.userId);
  const retained = await backendSnapshot(secondDevice, first.token);
  expect(retained.lessons).toHaveLength(1);
  expect(retained.lessons[0].notes).toBe('Keep this private across account transitions.');
});

import { test, expect, signIn, backendSnapshot, navigate } from './helpers';
import { tinyPNG } from './image';

test('real no-key and local upstream failures remain visible without fabricated answers or saved meals', async ({ app }) => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  expect(email, 'Set E2E_ADMIN_EMAIL for the isolated local E2E administrator').toBeTruthy();
  expect(password, 'Set E2E_ADMIN_PASSWORD for the isolated local E2E administrator').toBeTruthy();
  const token = await signIn(app, { email: email!, password: password! });
  const before = await backendSnapshot(app, token);
  expect(before.profile.role).toBe('admin');
  const disabled = await app.request.put(new URL('/api/v1/admin/provider', app.url()).toString(), {
    headers: { authorization: `Bearer ${token}` },
    data: { provider: 'openai', model: 'local-test-stub', enabled: false }
  });
  expect(disabled.status()).toBe(200);
  await app.reload();
  await navigate(app, 'Dashboard');
  await app.getByRole('button', { name: 'Ask AI', exact: true }).click();
  let dialog = app.getByRole('dialog');
  await dialog.getByLabel('Your question', { exact: true }).fill('How do I organize this workout?');
  const noKey = app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/assistant/question');
  await dialog.getByRole('button', { name: 'Ask AI', exact: true }).click();
  expect((await noKey).status()).toBeGreaterThanOrEqual(400);
  await expect(dialog.getByRole('alert')).toContainText(/configured|enabled|provider|available/i);
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  await app.getByRole('button', { name: 'AI Provider Settings', exact: true }).click();
  dialog = app.getByRole('dialog');
  await dialog.getByLabel('Provider', { exact: true }).selectOption('openai');
  await dialog.getByLabel('Model', { exact: true }).fill('local-test-stub');
  await dialog.getByLabel('API key', { exact: true }).fill('fake-key-only-for-the-local-upstream-stub');
  await dialog.getByLabel('Daily request limit', { exact: true }).fill('50');
  await dialog.getByLabel('Enable AI', { exact: true }).check();
  const configuration = app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/provider' && response.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save AI Settings', exact: true }).click();
  const configured = await configuration;
  expect(configured.status()).toBe(200);
  expect(await configured.text()).not.toContain('fake-key-only-for-the-local-upstream-stub');
  await expect(dialog).not.toBeVisible();
  await app.getByRole('button', { name: 'Ask AI', exact: true }).click();
  dialog = app.getByRole('dialog');
  await dialog.getByLabel('Your question', { exact: true }).fill('Question for the local failing stub.');
  const failed = app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/assistant/question');
  await dialog.getByRole('button', { name: 'Ask AI', exact: true }).click();
  expect((await failed).status()).toBeGreaterThanOrEqual(400);
  await expect(dialog.getByRole('alert')).toContainText(/provider|upstream|available|connect|failed/i);
  expect((await backendSnapshot(app, token)).foodEntries).toEqual(before.foodEntries);
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await navigate(app, 'Nutrition');
  await app.getByRole('button', { name: 'Estimate from Photo', exact: true }).click();
  dialog = app.getByRole('dialog');
  await dialog.getByLabel('Meal photo', { exact: true }).setInputFiles({ name: 'test-meal.png', mimeType: 'image/png', buffer: tinyPNG() });
  const mealFailure = app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/assistant/meal');
  await dialog.getByRole('button', { name: 'Estimate Nutrition', exact: true }).click();
  expect((await mealFailure).status()).toBeGreaterThanOrEqual(400);
  await expect(dialog.getByRole('alert')).toContainText(/provider|upstream|available|connect|failed/i);
  await expect(dialog.getByRole('button', { name: 'Save Meal to Log', exact: true })).not.toBeVisible();
  expect((await backendSnapshot(app, token)).foodEntries).toEqual(before.foodEntries);
  expect(JSON.stringify(await backendSnapshot(app, token))).not.toContain('fake-key-only-for-the-local-upstream-stub');
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const reset = await app.request.put(new URL('/api/v1/admin/provider', app.url()).toString(), {
    headers: { authorization: `Bearer ${token}` }, data: { provider: 'openai', model: 'local-test-stub', enabled: false }
  });
  expect(reset.status()).toBe(200);
});

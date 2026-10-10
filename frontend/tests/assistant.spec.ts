import { test, expect, TODAY, navigate, snapshot } from './helpers';

const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64');

test('the training assistant labels its answer as simulated preview content', async ({ app }) => {
  await app.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Your question', { exact: true }).fill('How do I choose a sensible rest time between sets?');
  await dialog.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const answer = dialog.getByRole('article').filter({ hasText: 'PREVIEW RESPONSE' });
  await expect(answer).toBeVisible();
  await expect(dialog).toContainText(/simulated|preview/i);
  await expect(answer.getByRole('paragraph')).not.toHaveText('');
});

test('a meal-photo estimate remains a draft until explicit review and save', async ({ app }) => {
  await navigate(app, 'nutrition');
  const original = (await snapshot(app)).foodEntries;
  await app.getByRole('button', { name: 'Estimate from Photo', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Meal photo', { exact: true }).setInputFiles({ name: 'preview-meal.png', mimeType: 'image/png', buffer: IMAGE });
  await dialog.getByRole('button', { name: 'Estimate Nutrition', exact: true }).click();
  await expect(dialog).toContainText(/simulated|preview/i);
  await expect(dialog.getByRole('button', { name: 'Save Meal to Log', exact: true })).toBeVisible();
  expect((await snapshot(app)).foodEntries).toEqual(original);

  await dialog.getByLabel('Meal', { exact: true }).selectOption('Dinner');
  await dialog.getByRole('button', { name: 'Save Meal to Log', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = (await snapshot(app)).foodEntries.filter(item => item.source === 'ai-estimate');
  expect(saved.length).toBeGreaterThan(0);
  expect(saved.every(item => item.date === TODAY && item.meal === 'Dinner')).toBe(true);
  expect(saved.reduce((sum, item) => sum + item.calories, 0)).toBeGreaterThan(0);
});

test('a rejected image leaves the food log unchanged and exposes the error', async ({ app }) => {
  await navigate(app, 'nutrition');
  const original = (await snapshot(app)).foodEntries;
  await app.getByRole('button', { name: 'Estimate from Photo', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Meal photo', { exact: true }).setInputFiles({ name: 'meal.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(app.getByRole('alert')).toBeVisible();
  expect((await snapshot(app)).foodEntries).toEqual(original);
  await expect(dialog.getByRole('button', { name: 'Estimate Nutrition', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save Meal to Log', exact: true })).not.toBeVisible();
});

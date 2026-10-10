import type { Page } from '@playwright/test';
import { test, expect, TODAY, TOMORROW, navigate, snapshot } from './helpers';

async function addManualFood(page: Page, name: string, calories: number): Promise<void> {
  await page.getByRole('button', { name: 'Add food to Breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Add Food Manually', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Food name', { exact: true }).fill(name);
  await dialog.getByLabel('Calories', { exact: true }).fill(String(calories));
  await dialog.getByLabel('Protein (g)', { exact: true }).fill('10');
  await dialog.getByLabel('Carbs (g)', { exact: true }).fill('13');
  await dialog.getByLabel('Fat (g)', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Save Food', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('manual food changes totals, persists, and can be edited and deleted', async ({ app }) => {
  await navigate(app, 'nutrition');
  const before = await snapshot(app);
  const initialCalories = before.foodEntries.filter(item => item.date === TODAY).reduce((sum, item) => sum + item.calories, 0);
  await addManualFood(app, 'Browser test breakfast', 101);
  await expect(app.getByTestId('calorie-total')).toContainText(String(initialCalories + 101));
  await expect.poll(async () => (await snapshot(app)).foodEntries.find(item => item.name === 'Browser test breakfast')?.protein).toBe(10);

  await app.reload();
  await navigate(app, 'nutrition');
  await expect(app.getByTestId('calorie-total')).toContainText(String(initialCalories + 101));
  await app.getByRole('button', { name: 'Breakfast', exact: true }).click();
  await app.getByRole('button', { name: /Browser test breakfast/ }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Calories', { exact: true }).fill('150');
  await dialog.getByRole('button', { name: 'Save Food', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(app.getByTestId('calorie-total')).toContainText(String(initialCalories + 150));

  await app.getByRole('button', { name: /Browser test breakfast/ }).click();
  await app.getByRole('dialog').getByRole('button', { name: 'Delete Food', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect(app.getByTestId('calorie-total')).toContainText(String(initialCalories));
  expect((await snapshot(app)).foodEntries.some(item => item.name === 'Browser test breakfast')).toBe(false);
});

test('food search scales servings and copies a dated log without changing the original', async ({ app }) => {
  await navigate(app, 'nutrition');
  await app.getByRole('button', { name: 'Add food to Dinner', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Search foods', { exact: true }).fill('banana');
  await app.getByRole('button', { name: /Banana/ }).click();
  const dialog = app.getByRole('dialog');
  const perServingCalories = Number(await dialog.getByLabel('Calories', { exact: true }).inputValue());
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Save Food', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const original = (await snapshot(app)).foodEntries.filter(item => item.date === TODAY);
  expect(original.find(item => /banana/i.test(item.name))).toEqual(expect.objectContaining({ quantity: 2, calories: perServingCalories * 2, meal: 'Dinner' }));

  await app.getByRole('button', { name: 'Next day', exact: true }).click();
  await app.getByRole('button', { name: 'Copy food log', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Copy from', { exact: true }).fill(TODAY);
  await app.getByRole('dialog').getByRole('button', { name: 'Copy Food Log', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const after = await snapshot(app);
  expect(after.foodEntries.filter(item => item.date === TODAY)).toEqual(original);
  const copied = after.foodEntries.filter(item => item.date === TOMORROW);
  expect(copied).toHaveLength(original.length);
  expect(copied.reduce((sum, item) => sum + item.calories, 0)).toBe(original.reduce((sum, item) => sum + item.calories, 0));
  expect(copied.every(item => !original.some(source => source.id === item.id))).toBe(true);
});

test('manual target overrides remain dated and survive reload', async ({ app }) => {
  await navigate(app, 'nutrition');
  await app.getByRole('button', { name: 'Nutrition settings', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Calories', { exact: true }).fill('2400');
  await dialog.getByLabel('Protein (g)', { exact: true }).fill('130');
  await dialog.getByLabel('Carbs (g)', { exact: true }).fill('300');
  await dialog.getByLabel('Fat (g)', { exact: true }).fill('65');
  await dialog.getByRole('button', { name: 'Save Targets', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const changed = (await snapshot(app)).targets.find(item => item.effectiveDate === TODAY);
  expect(changed).toEqual(expect.objectContaining({ calories: 2400, protein: 130, carbs: 300, fat: 65, mode: 'manual', manuallyOverridden: true }));
  await app.reload();
  await navigate(app, 'nutrition');
  await app.getByRole('button', { name: 'Nutrition settings', exact: true }).click();
  await expect(app.getByRole('dialog').getByLabel('Calories', { exact: true })).toHaveValue('2400');
});

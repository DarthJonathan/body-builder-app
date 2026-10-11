import type { Page } from '@playwright/test';
import type { TargetCalculation } from '../src/lib/domain';
import golden from '../../docs/fixtures/nutrition-calculation.json' with { type: 'json' };
import { test, expect, TODAY, TOMORROW, navigate, snapshot, openCheckIn, fillCheckIn } from './helpers';

const baseInput = { ...golden.cases[0].input, effectiveDate: TODAY } as TargetCalculation;

async function openCalculator(page: Page): Promise<void> {
  await navigate(page, 'nutrition');
  await page.getByRole('button', { name: 'Nutrition settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Calculate Targets', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Calculate Nutrition Targets', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Age', { exact: true })).toBeEnabled();
}

async function fillCalculation(page: Page, input: TargetCalculation, weight?: string | null): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Age', { exact: true }).fill(String(input.age));
  await dialog.getByLabel('Equation sex', { exact: true }).selectOption(input.sex);
  await dialog.getByLabel('Height (cm)', { exact: true }).fill(String(input.heightCm));
  if (weight !== null) await dialog.getByLabel(/^Weight \((kg|lb)\)$/).fill(weight ?? String(input.weightKg));
  await dialog.getByLabel('Activity level', { exact: true }).selectOption(input.activity);
  await dialog.getByLabel('Goal', { exact: true }).selectOption(input.goal);
  await dialog.getByLabel('Effective date', { exact: true }).fill(input.effectiveDate);
  await dialog.getByLabel('Calorie adjustment (kcal/day)', { exact: true }).fill(String(input.calorieAdjustment));
  await dialog.getByLabel('Protein (g/kg/day)', { exact: true }).fill(String(input.proteinPerKg));
  await dialog.getByLabel('Fat (% of calories)', { exact: true }).fill(String(input.fatPercent));
}

async function preview(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Preview Targets', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Target Preview', exact: true })).toBeVisible();
  await expect(page.getByTestId('calculated-calories')).toBeInViewport();
}

test('calculation requires personal choices and previews shared formula values without saving', async ({ app }) => {
  const before = await snapshot(app);
  await openCalculator(app);
  const dialog = app.getByRole('dialog');
  for (const label of ['Age', 'Equation sex', 'Height (cm)', 'Activity level']) {
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel(label, { exact: true })).toHaveJSProperty('required', true);
  }
  await dialog.getByRole('button', { name: 'Preview Targets', exact: true }).click();
  expect(await dialog.getByLabel('Age', { exact: true }).evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Apply Targets', exact: true })).not.toBeVisible();

  for (const [index, item] of [golden.cases[0], golden.cases[2], golden.cases[7]].entries()) {
    if (index) await app.getByRole('dialog').getByRole('button', { name: 'Edit Inputs', exact: true }).click();
    const input = { ...item.input, effectiveDate: TODAY } as TargetCalculation;
    await fillCalculation(app, input);
    await preview(app);
    await expect(app.getByTestId('calculated-calories')).toHaveText(item.expected.calories.toLocaleString('en'));
    for (const key of ['protein', 'carbs', 'fat'] as const) await expect(app.getByTestId(`calculated-${key}`)).toHaveText(String(item.expected[key]));
    await expect(app.getByRole('dialog')).toContainText('Mifflin–St Jeor');
    await expect(app.getByRole('dialog')).toContainText('mifflin-st-jeor-v1');
    await expect(app.getByRole('dialog')).toContainText(item.expected.maintenanceCalories.toLocaleString('en'));
    await expect(app.getByRole('dialog')).toContainText(input.effectiveDate);
    expect(await snapshot(app)).toEqual(before);
  }
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Nutrition Targets', exact: true })).toBeVisible();
  expect(await snapshot(app)).toEqual(before);
});

// Keep this full interaction flow available locally and in opt-in manual CI.
// Formula and persistence coverage still runs in the automatic unit/live suites.
test('applied calculations and manual overrides retain dated provenance through recalculation', { tag: '@manual-ci' }, async ({ app }) => {
  const before = await snapshot(app);
  await openCalculator(app);
  await fillCalculation(app, baseInput);
  await preview(app);
  await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const applied = (await snapshot(app)).targets.find(item => item.effectiveDate === TODAY)!;
  expect(applied).toEqual(expect.objectContaining({ mode: 'calculated', manuallyOverridden: false, calories: 2300, protein: 96, carbs: 335, fat: 64 }));
  expect(applied.calculation).toEqual({ version: 'mifflin-st-jeor-v1', input: baseInput, restingCalories: 1320, maintenanceCalories: 2046 });

  await app.getByRole('button', { name: 'Nutrition settings', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Calories', { exact: true }).fill('2400');
  await app.getByRole('dialog').getByRole('button', { name: 'Save Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const overridden = (await snapshot(app)).targets.find(item => item.effectiveDate === TODAY)!;
  expect(overridden).toEqual(expect.objectContaining({ id: applied.id, mode: 'manual', manuallyOverridden: true, calories: 2400, calculation: applied.calculation }));
  await app.reload();
  await openCalculator(app);
  await fillCalculation(app, { ...baseInput, goal: 'lose-fat', calorieAdjustment: -300 });
  await preview(app);
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await snapshot(app)).targets.find(item => item.effectiveDate === TODAY)).toEqual(overridden);
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await app.getByRole('button', { name: 'Next day', exact: true }).click();
  await openCalculator(app);
  await fillCalculation(app, { ...baseInput, effectiveDate: TOMORROW, goal: 'maintain', calorieAdjustment: 0 });
  await preview(app);
  await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const history = (await snapshot(app)).targets;
  expect(history.find(item => item.effectiveDate === TODAY)).toEqual(overridden);
  expect(history.find(item => item.effectiveDate === TOMORROW)).toEqual(expect.objectContaining({ mode: 'calculated', calories: 2050 }));
  expect(history.filter(item => item.effectiveDate < TODAY)).toEqual(before.targets);
  await app.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await openCheckIn(app);
  await fillCheckIn(app, '65', 'A measurement does not change calculated or manual targets.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  expect((await snapshot(app)).targets).toEqual(history);
});

test('pounds prefill preserves acknowledged kilograms and edited pounds convert explicitly', async ({ app }) => {
  await openCheckIn(app);
  await fillCheckIn(app, '60', 'Acknowledged calculator weight.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Weight unit', { exact: true }).selectOption('lb');
  await app.getByRole('dialog').getByRole('button', { name: 'Save Account', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await openCalculator(app);
  await expect(app.getByRole('dialog').getByLabel('Weight (lb)', { exact: true })).toHaveValue('132.3');
  await expect(app.getByRole('dialog')).toContainText('Saved weight');
  await fillCalculation(app, baseInput, null);
  await preview(app);
  await expect(app.getByTestId('calculated-calories')).toHaveText('2,300');
  await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const saved = (await snapshot(app)).targets.find(item => item.effectiveDate === TODAY)!;
  expect(saved.calculation?.input.weightKg).toBe(60);

  await openCalculator(app);
  await fillCalculation(app, baseInput, '150');
  await preview(app);
  await expect(app.getByTestId('calculated-calories')).toHaveText('2,420');
  await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  expect((await snapshot(app)).targets.find(item => item.effectiveDate === TODAY)?.calculation?.input.weightKg).toBe(68.04);
  expect((await snapshot(app)).weights.find(item => item.date === TODAY)?.weight).toBe(60);
});

test('out-of-range calories and impossible allocations expose errors without saving', async ({ app }) => {
  const before = await snapshot(app);
  await openCalculator(app);
  await fillCalculation(app, { ...baseInput, age: 100, sex: 'female', heightCm: 100, weightKg: 350, activity: 'sedentary', goal: 'lose-fat', calorieAdjustment: -500, proteinPerKg: 3, fatPercent: 40 });
  await app.getByRole('dialog').getByRole('button', { name: 'Preview Targets', exact: true }).click();
  await expect(app.getByRole('dialog').getByRole('alert')).toContainText(/protein.*fat|calorie target/i);
  await expect(app.getByRole('button', { name: 'Apply Targets', exact: true })).not.toBeVisible();
  expect(await snapshot(app)).toEqual(before);
  await fillCalculation(app, { ...baseInput, age: 100, heightCm: 100, weightKg: 30, activity: 'sedentary', goal: 'lose-fat', calorieAdjustment: -500 });
  await app.getByRole('dialog').getByRole('button', { name: 'Preview Targets', exact: true }).click();
  await expect(app.getByRole('dialog').getByRole('alert')).toContainText(/outside|1,?000|range/i);
  expect(await snapshot(app)).toEqual(before);
});

test('another preview account never inherits saved or unsaved personal calculator inputs', async ({ app }) => {
  await openCalculator(app);
  await fillCalculation(app, baseInput);
  await preview(app);
  await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const first = await snapshot(app);
  await openCalculator(app);
  await app.getByRole('dialog').getByLabel('Age', { exact: true }).fill('77');
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Switch preview account', { exact: true }).fill('calculator-private@preview.bodybuilder.app');
  await app.getByRole('dialog').getByRole('button', { name: 'Switch Account', exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).profile.email).toBe('calculator-private@preview.bodybuilder.app');
  await openCalculator(app);
  for (const label of ['Age', 'Equation sex', 'Height (cm)', 'Activity level']) await expect(app.getByRole('dialog').getByLabel(label, { exact: true })).toHaveValue('');
  expect((await snapshot(app)).targets.some(item => item.calculation)).toBe(false);
  const original = await app.evaluate(email => JSON.parse(localStorage.getItem(`bodybuilder.preview.account.v1:${encodeURIComponent(email)}`)!).snapshot.targets, first.profile.email);
  expect(original).toEqual(first.targets);
});

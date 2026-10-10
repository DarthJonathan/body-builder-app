import type { Page } from '@playwright/test';
import type { TargetCalculation } from '../../src/lib/domain';
import { shiftDate } from '../../src/lib/domain';
import golden from '../../../docs/fixtures/nutrition-calculation.json' with { type: 'json' };
import { createOfflineProxy } from '../offline-proxy';
import { test, expect, registerAccount, signIn, signOut, backendSnapshot, navigate, openCheckIn, saveCheckIn, pendingOperations, today } from './helpers';

const source = 'USDA FoodData Central · SR Legacy April 2018 · FDC 173944 · CC0-1.0 · https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';
const inputFor = (date: string): TargetCalculation => ({ ...golden.cases[0].input, effectiveDate: date }) as TargetCalculation;

async function openCalculator(page: Page): Promise<void> {
  await navigate(page, 'Nutrition');
  await page.getByRole('button', { name: 'Nutrition settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Calculate Targets', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Calculate Nutrition Targets', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Age', { exact: true })).toBeEnabled();
}

async function fillCalculation(page: Page, input: TargetCalculation, preserveWeight = false): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Age', { exact: true }).fill(String(input.age));
  await dialog.getByLabel('Equation sex', { exact: true }).selectOption(input.sex);
  await dialog.getByLabel('Height (cm)', { exact: true }).fill(String(input.heightCm));
  if (!preserveWeight) await dialog.getByLabel('Weight (kg)', { exact: true }).fill(String(input.weightKg));
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
}

function watchAssistant(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/assistant/')) requests.push(new URL(request.url()).pathname);
  });
  return requests;
}

test('regular calculator previews use the read-only API and never call AI or save implicitly', async ({ app }, testInfo) => {
  const account = await registerAccount(app, testInfo, 'nutrition-preview');
  const date = await today(app);
  const before = await backendSnapshot(app, account.token);
  const assistantCalls = watchAssistant(app);
  const mutations: string[] = [];
  app.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/mutations') mutations.push(request.method()); });
  await openCalculator(app);
  for (const label of ['Age', 'Equation sex', 'Height (cm)', 'Weight (kg)', 'Activity level']) await expect(app.getByRole('dialog').getByLabel(label, { exact: true })).toHaveValue('');
  await app.getByRole('dialog').getByRole('button', { name: 'Preview Targets', exact: true }).click();
  expect(await app.getByRole('dialog').getByLabel('Age', { exact: true }).evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  await fillCalculation(app, inputFor(date));
  const responsePromise = app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/nutrition/calculate');
  await preview(app);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.request().postDataJSON()).toEqual(inputFor(date));
  const result = (await response.json()).data;
  expect(result).toEqual(expect.objectContaining({ mode: 'calculated', manuallyOverridden: false, calories: 2300, protein: 96, carbs: 335, fat: 64 }));
  expect(result.calculation).toEqual({ version: 'mifflin-st-jeor-v1', input: inputFor(date), restingCalories: 1320, maintenanceCalories: 2046 });
  await expect(app.getByTestId('calculated-calories')).toHaveText('2,300');
  await expect(app.getByRole('dialog')).toContainText('moderate × 1.55');
  await expect(app.getByRole('dialog')).toContainText('+250 kcal/day');
  await expect(app.getByRole('dialog')).toContainText('2,046 kcal/day');
  expect(await backendSnapshot(app, account.token)).toEqual(before);
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await backendSnapshot(app, account.token)).toEqual(before);
  expect(mutations).toEqual([]);
  expect(assistantCalls).toEqual([]);
});

test('real calculated targets synchronize provenance, retain manual history and remain private', async ({ app, secondDevice }, testInfo) => {
  const account = await registerAccount(app, testInfo, 'nutrition-history');
  await signIn(secondDevice, account);
  const date = await today(app);
  const assistantCalls = watchAssistant(app);
  await openCalculator(app);
  await fillCalculation(app, inputFor(date));
  await preview(app);
  await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).targets.length).toBe(1);
  const calculated = (await backendSnapshot(app, account.token)).targets[0];
  expect(calculated.calculation?.input).toEqual(inputFor(date));
  expect(calculated).toEqual(expect.objectContaining({ mode: 'calculated', manuallyOverridden: false, calories: 2300 }));

  await secondDevice.bringToFront();
  await secondDevice.evaluate(() => window.dispatchEvent(new Event('focus')));
  await navigate(secondDevice, 'Nutrition');
  await secondDevice.getByRole('button', { name: 'Nutrition settings', exact: true }).click();
  await expect(secondDevice.getByRole('dialog').getByLabel('Calories', { exact: true })).toHaveValue('2300');
  await expect(secondDevice.getByRole('dialog')).toContainText('Mifflin–St Jeor');
  await secondDevice.getByRole('dialog').getByLabel('Calories', { exact: true }).fill('2400');
  await secondDevice.getByRole('dialog').getByRole('button', { name: 'Save Targets', exact: true }).click();
  await expect(secondDevice.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).targets[0]?.calories).toBe(2400);
  const overridden = (await backendSnapshot(app, account.token)).targets[0];
  expect(overridden).toEqual(expect.objectContaining({ id: calculated.id, mode: 'manual', manuallyOverridden: true, calculation: calculated.calculation }));

  await app.reload();
  await openCalculator(app);
  await expect(app.getByRole('dialog').getByLabel('Age', { exact: true })).toHaveValue('30');
  await fillCalculation(app, { ...inputFor(date), goal: 'lose-fat', calorieAdjustment: -300 });
  await preview(app);
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await backendSnapshot(app, account.token)).targets[0]).toEqual(overridden);
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await app.getByRole('button', { name: 'Next day', exact: true }).click();
  await openCalculator(app);
  await fillCalculation(app, { ...inputFor(shiftDate(date, 1)), goal: 'maintain', calorieAdjustment: 0 });
  await preview(app);
  await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).targets.length).toBe(2);
  const targets = (await backendSnapshot(app, account.token)).targets;
  expect(targets.find(item => item.effectiveDate === date)).toEqual(overridden);
  expect(targets.find(item => item.effectiveDate === shiftDate(date, 1))).toEqual(expect.objectContaining({ mode: 'calculated', calories: 2050 }));
  await app.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await openCheckIn(app);
  await saveCheckIn(app, '65', 'Acknowledged weight must not auto-adjust targets.');
  expect((await backendSnapshot(app, account.token)).targets).toEqual(targets);
  await signOut(app);
  const other = await registerAccount(app, testInfo, 'nutrition-private');
  expect((await backendSnapshot(app, other.token)).targets).toEqual([]);
  await openCalculator(app);
  for (const label of ['Age', 'Equation sex', 'Height (cm)', 'Weight (kg)', 'Activity level']) await expect(app.getByRole('dialog').getByLabel(label, { exact: true })).toHaveValue('');
  expect((await backendSnapshot(secondDevice, account.token)).targets).toEqual(targets);
  expect(assistantCalls).toEqual([]);
});

test('genuine USDA foods remain searchable with a failed upstream and save reviewed source quantities', async ({ app }, testInfo) => {
  const account = await registerAccount(app, testInfo, 'usda-food');
  const assistantCalls = watchAssistant(app);
  await navigate(app, 'Nutrition');
  await app.getByRole('button', { name: 'Add food to Breakfast', exact: true }).click();
  const dialog = app.getByRole('dialog');
  const searched = app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/foods/search' && new URL(response.url()).searchParams.get('q') === 'banana');
  await dialog.getByLabel('Search foods', { exact: true }).fill('banana');
  // Opening autofocus must not take focus from a field the user has entered.
  await app.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(dialog.getByLabel('Search foods', { exact: true })).toBeFocused();
  await dialog.getByLabel('Search foods', { exact: true }).press('Enter');
  const response = await searched;
  expect(response.status()).toBe(200);
  const banana = (await response.json()).data.find((item: { id: string }) => item.id === 'usda:173944');
  expect(banana).toEqual({ id: 'usda:173944', name: 'Bananas, raw', serving: '100 g', source, calories: 89, protein: 1.09, carbs: 22.84, fat: 0.33 });
  const result = dialog.getByRole('button', { name: /^Bananas, raw\b/ });
  await result.click();
  await expect(app.getByTestId('food-database-source')).toHaveText(source);
  await expect(dialog.getByLabel('Serving size', { exact: true })).toHaveValue('100 g');
  expect((await backendSnapshot(app, account.token)).foodEntries).toEqual([]);
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  for (const [label, value] of [['Calories', '178'], ['Protein (g)', '2.18'], ['Carbs (g)', '45.68'], ['Fat (g)', '0.66']]) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
  await dialog.getByRole('button', { name: 'Save Food', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).foodEntries.length).toBe(1);
  const saved = (await backendSnapshot(app, account.token)).foodEntries[0];
  expect(saved).toEqual(expect.objectContaining({ foodId: 'usda:173944', databaseSource: source, quantity: 2, calories: 178, protein: 2.18, carbs: 45.68, fat: 0.66 }));
  await app.reload();
  await navigate(app, 'Nutrition');
  await expect(app.getByTestId('calorie-total')).toHaveText('178');
  const breakfast = app.getByRole('button', { name: 'Breakfast', exact: true });
  if (await breakfast.getAttribute('aria-expanded') !== 'true') await breakfast.click();
  await app.getByRole('button', { name: /^Bananas, raw/ }).click();
  await expect(app.getByTestId('food-database-source')).toHaveText(source);
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await app.getByRole('button', { name: 'Add food to Breakfast', exact: true }).click();
  const query = `unmatched-usda-${account.userId}`;
  const unavailable = app.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/foods/search' && new URL(result.url()).searchParams.get('q') === query);
  await app.getByRole('dialog').getByLabel('Search foods', { exact: true }).fill(query);
  await expect(app.getByRole('dialog').getByLabel('Search foods', { exact: true })).toHaveValue(query);
  await app.getByRole('dialog').getByRole('button', { name: 'Search', exact: true }).click();
  expect((await unavailable).status()).toBe(503);
  await expect(app.getByRole('dialog').getByRole('alert')).toContainText(/unavailable|try.*later/i);
  await expect(app.getByRole('dialog').getByRole('button', { name: /^Bananas, raw/ })).not.toBeVisible();
  expect((await backendSnapshot(app, account.token)).foodEntries).toEqual([saved]);
  expect(assistantCalls).toEqual([]);
});

test('offline calculator uses acknowledged weight, previews locally and applies through the real outbox', async ({ app, baseURL }, testInfo) => {
  const proxy = await createOfflineProxy(baseURL!);
  try {
    await app.goto(proxy.origin);
    const account = await registerAccount(app, testInfo, 'offline-calculation');
    const date = await today(app);
    await openCheckIn(app);
    await saveCheckIn(app, '60', 'Acknowledged weight before the outage.');
    await expect.poll(async () => (await backendSnapshot(app, account.token)).weights[0]?.weight).toBe(60);
    const acknowledged = await backendSnapshot(app, account.token);
    const assistantCalls = watchAssistant(app);
    proxy.setAvailable(false);
    expect(await app.evaluate(async () => {
      try { await fetch(`/__offline_probe__?id=${crypto.randomUUID()}`, { cache: 'no-store' }); return false; }
      catch { return true; }
    }), 'The calculator must run with the actual origin transport unavailable').toBe(true);
    await openCheckIn(app);
    await saveCheckIn(app, '75', 'Pending weight must not prefill the calculator.');
    await expect.poll(async () => (await pendingOperations(app, account.userId)).length).toBe(1);
    await openCalculator(app);
    await expect(app.getByRole('dialog').getByLabel('Weight (kg)', { exact: true })).toHaveValue('60');
    await fillCalculation(app, inputFor(date), true);
    await preview(app);
    await expect(app.getByRole('dialog')).toContainText('Calculated on this device while offline');
    await expect(app.getByTestId('calculated-calories')).toHaveText('2,300');
    expect(await backendSnapshot(app, account.token, baseURL!)).toEqual(acknowledged);
    expect((await pendingOperations(app, account.userId)).map(item => item.operation)).toEqual(['saveCheckIn']);
    await app.getByRole('dialog').getByRole('button', { name: 'Apply Targets', exact: true }).click();
    await expect(app.getByRole('dialog')).not.toBeVisible();
    const queued = await pendingOperations(app, account.userId);
    expect(queued.map(item => item.operation)).toEqual(['saveCheckIn', 'saveTargets']);
    expect(queued.map(item => item.baseRevision)).toEqual([acknowledged.revision, acknowledged.revision + 1]);
    expect(queued[1].payload).toEqual(expect.objectContaining({ mode: 'calculated', manuallyOverridden: false, calculation: { version: 'mifflin-st-jeor-v1', input: inputFor(date), restingCalories: 1320, maintenanceCalories: 2046 } }));
    expect(await backendSnapshot(app, account.token, baseURL!)).toEqual(acknowledged);
    const replayed = Promise.all(queued.map(item => app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/mutations' && response.status() === 200 && response.request().postDataJSON()?.id === item.id)));
    proxy.setAvailable(true);
    await app.evaluate(() => window.dispatchEvent(new Event('online')));
    await replayed;
    await expect.poll(async () => (await pendingOperations(app, account.userId)).length).toBe(0);
    const saved = await backendSnapshot(app, account.token);
    expect(saved.revision).toBe(acknowledged.revision + 2);
    expect(saved.weights[0].weight).toBe(75);
    expect(saved.targets[0].calculation?.input.weightKg).toBe(60);
    expect(saved.targets[0].calories).toBe(2300);
    expect(assistantCalls).toEqual([]);
  } finally { await proxy.close(); }
});

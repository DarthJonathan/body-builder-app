import { test, expect, TODAY, fillCheckIn, navigate, openCheckIn, snapshot } from './helpers';

test('daily check-in persists weight and notes, and editing upserts one Progress measurement', async ({ app }) => {
  await openCheckIn(app);
  await fillCheckIn(app, '57.2', 'Slept well. Training felt strong.');
  await expect(app.getByRole('dialog')).not.toBeVisible();

  await expect.poll(async () => (await snapshot(app)).checkIns.find(item => item.date === TODAY)?.weight).toBe(57.2);
  let stored = await snapshot(app);
  expect(stored.checkIns.filter(item => item.date === TODAY)).toHaveLength(1);
  expect(stored.weights.filter(item => item.date === TODAY)).toEqual([
    expect.objectContaining({ date: TODAY, weight: 57.2 })
  ]);

  await app.reload();
  await openCheckIn(app);
  await expect(app.getByRole('dialog').getByLabel('Weight (kg)', { exact: true })).toHaveValue('57.2');
  await expect(app.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('Slept well. Training felt strong.');
  await fillCheckIn(app, '57.4', 'Updated the measurement.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await snapshot(app)).checkIns.find(item => item.date === TODAY)?.notes).toBe('Updated the measurement.');

  stored = await snapshot(app);
  expect(stored.checkIns.filter(item => item.date === TODAY)).toEqual([
    expect.objectContaining({ weight: 57.4, notes: 'Updated the measurement.' })
  ]);
  expect(stored.weights.filter(item => item.date === TODAY)).toHaveLength(1);
  expect(stored.weights.find(item => item.date === TODAY)?.weight).toBe(57.4);
  await navigate(app, 'progress');
  await expect(app.getByText('57.4', { exact: false }).first()).toBeVisible();
});

test('a rejected check-in preserves the draft and does not write partial data', async ({ app }) => {
  const before = await snapshot(app);
  await openCheckIn(app);
  await app.evaluate(() => window.localStorage.setItem('bodybuilder.preview.fail-next', 'saveCheckIn'));
  await fillCheckIn(app, '58.1', 'Please retain this draft after the request fails.');

  await expect(app.getByRole('alert')).toBeVisible();
  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Weight (kg)', { exact: true })).toHaveValue('58.1');
  await expect(dialog.getByLabel('Notes', { exact: true })).toHaveValue('Please retain this draft after the request fails.');
  expect((await snapshot(app)).checkIns).toEqual(before.checkIns);
  expect((await snapshot(app)).weights).toEqual(before.weights);

  await dialog.getByRole('button', { name: 'Save Check-in', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await snapshot(app)).checkIns.find(item => item.date === TODAY)?.notes)
    .toBe('Please retain this draft after the request fails.');
});

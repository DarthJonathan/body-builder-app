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

test('save notifications let taps reach a check-in card underneath them', async ({ app }) => {
  await app.setViewportSize({ width: 393, height: 600 });
  await openCheckIn(app);
  await fillCheckIn(app, '57.2', 'Tap through the saved notification to edit.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const notification = app.getByRole('status').filter({ hasText: 'Daily check-in saved' });
  await expect(notification).toBeVisible();
  const card = app.getByRole('button', { name: /^Daily Check-in/ });

  // Position the real card beneath the floating notification, then send a
  // native pointer click in their overlap. Locator click's actionability
  // retries would otherwise wait for a blocking notification to disappear.
  await app.evaluate(async () => {
    const card = document.querySelector('.checkin-card')!.getBoundingClientRect();
    const toast = document.querySelector('.toast')!.getBoundingClientRect();
    window.scrollTo({ top: scrollY + card.y + card.height / 2 - toast.y - toast.height / 2, behavior: 'instant' });
    // WebKit updates layout before its scrolling layer is ready for native
    // hit testing. Wait for painted frames before reading click coordinates.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const cardBox = (await card.boundingBox())!;
  const toastBox = (await notification.boundingBox())!;
  const left = Math.max(cardBox.x, toastBox.x);
  const right = Math.min(cardBox.x + cardBox.width, toastBox.x + toastBox.width);
  const top = Math.max(cardBox.y, toastBox.y);
  const bottom = Math.min(cardBox.y + cardBox.height, toastBox.y + toastBox.height);
  expect(right - left).toBeGreaterThan(20);
  expect(bottom - top).toBeGreaterThan(20);
  await app.mouse.click((left + right) / 2, (top + bottom) / 2);
  await expect(app.getByRole('dialog', { name: 'Daily Check-in', exact: true })).toBeVisible();
  await expect(app.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('Tap through the saved notification to edit.');
});

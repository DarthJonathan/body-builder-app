import { test, expect, fillCheckIn, openCheckIn, snapshot, TOMORROW } from './helpers';

test('a Dashboard following Today advances its calendar and check-in when midnight passes', async ({ app }) => {
  await expect(app.getByRole('button', { name: 'Today, Oct 9', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await app.clock.fastForward(12 * 60 * 60 * 1_000 + 1_100);
  await expect(app.getByRole('button', { name: 'Today, Oct 10', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openCheckIn(app);
  await expect(app.getByRole('dialog')).toContainText('Today, Oct 10');
  await fillCheckIn(app, '57.8', 'A check-in for the new day.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await snapshot(app)).checkIns.find(item => item.date === TOMORROW)?.notes).toBe('A check-in for the new day.');
  expect((await snapshot(app)).checkIns.some(item => item.date === '2026-10-09' && item.notes === 'A check-in for the new day.')).toBe(false);
});

test('an intentionally selected past day stays selected when midnight passes', async ({ app }) => {
  await app.getByRole('button', { name: 'Yesterday, Oct 8', exact: true }).click();
  await app.clock.fastForward(12 * 60 * 60 * 1_000 + 1_100);
  await expect(app.getByRole('button', { name: 'Thu, Oct 8', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(app.getByRole('button', { name: 'Today, Oct 10', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await openCheckIn(app);
  await expect(app.getByRole('dialog')).toContainText('Thu, Oct 8');
  await fillCheckIn(app, '57.1', 'A correction to the deliberately selected past day.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await snapshot(app)).checkIns.find(item => item.date === '2026-10-08')?.notes).toBe('A correction to the deliberately selected past day.');
  expect((await snapshot(app)).checkIns.some(item => item.date === TOMORROW)).toBe(false);
});

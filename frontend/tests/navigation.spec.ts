import { test, expect, assertNoHorizontalOverflow, navigate, openTodayWorkout } from './helpers';

test('all five tabs remain reachable at small, phone, landscape, and desktop widths', async ({ app }) => {
  for (const size of [{ width: 320, height: 740 }, { width: 430, height: 932 }, { width: 852, height: 393 }, { width: 1280, height: 900 }]) {
    await app.setViewportSize(size);
    for (const tab of ['lessons', 'nutrition', 'dashboard', 'workout', 'progress'] as const) {
      await navigate(app, tab);
      await expect(app.getByRole('button', { name: tab[0].toUpperCase() + tab.slice(1), exact: true })).toBeVisible();
      await assertNoHorizontalOverflow(app);
    }
  }
  await app.setViewportSize({ width: 320, height: 740 });
  await openTodayWorkout(app);
  await assertNoHorizontalOverflow(app);
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await assertNoHorizontalOverflow(app);
});

test('selected dates isolate nutrition totals and return to today', async ({ app }) => {
  await navigate(app, 'nutrition');
  await expect(app.getByTestId('calorie-total')).toContainText('938');
  await app.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(app.getByTestId('calorie-total')).toContainText('0');
  await app.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await expect(app.getByTestId('calorie-total')).toContainText('938');
});

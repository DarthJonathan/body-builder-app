import { test, expect, navigate, openTodayWorkout, assertNoHorizontalOverflow } from './helpers';

for (const tab of ['dashboard', 'nutrition', 'workout', 'progress', 'lessons'] as const) {
  test(`capture ${tab} at the iPhone reference viewport`, async ({ app }, testInfo) => {
    await navigate(app, tab);
    await assertNoHorizontalOverflow(app);
    await app.evaluate(() => document.fonts.ready);
    const path = testInfo.outputPath(`${tab}-393x852.png`);
    await app.screenshot({ path, fullPage: false, animations: 'disabled' });
    await testInfo.attach(`${tab} reference capture`, { path, contentType: 'image/png' });
  });
}

test('capture workout preview and active session at the reference viewport', async ({ app }, testInfo) => {
  await openTodayWorkout(app);
  await expect(app.getByRole('heading', { name: 'Target Muscles', exact: true })).toBeVisible();
  let path = testInfo.outputPath('workout-preview-393x852.png');
  await app.screenshot({ path, fullPage: false, animations: 'disabled' });
  await testInfo.attach('workout preview reference capture', { path, contentType: 'image/png' });

  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expect(app.getByLabel('Barbell Deadlift set 1 reps', { exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(app);
  path = testInfo.outputPath('active-workout-393x852.png');
  await app.screenshot({ path, fullPage: false, animations: 'disabled' });
  await testInfo.attach('active workout reference capture', { path, contentType: 'image/png' });
});

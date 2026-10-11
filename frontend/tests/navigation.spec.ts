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

test('bottom tabs stay compact above the home indicator and nutrition controls follow them', async ({ app }, testInfo) => {
  // Browser emulation does not supply iPhone safe-area insets. Exercise both
  // ordinary browser spacing and the inset used by a standalone iPhone app.
  for (const inset of [0, 34]) {
    await app.evaluate(value => document.documentElement.style.setProperty('--safe-bottom', `${value}px`), inset);
    await navigate(app, 'lessons');
    const navigation = app.getByRole('navigation', { name: 'Main navigation' });
    const geometry = await navigation.evaluate(element => {
      const nav = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      return { height: nav.height, bottom: nav.bottom, viewport: innerHeight,
        bottomSpace: nav.bottom - Math.max(...buttons.map(button => button.bottom)),
        smallestTarget: Math.min(...buttons.map(button => button.height)) };
    });
    expect(geometry.bottom).toBeCloseTo(geometry.viewport, 0);
    expect(geometry.smallestTarget).toBeGreaterThanOrEqual(44);
    expect(geometry.bottomSpace).toBeGreaterThanOrEqual(inset);
    expect(geometry.bottomSpace).toBeLessThanOrEqual(Math.max(8, inset) + 1);
    expect(geometry.height - geometry.bottomSpace).toBeLessThanOrEqual(60);
    if (inset) {
      await app.evaluate(() => document.fonts.ready);
      const path = testInfo.outputPath('lessons-home-indicator-393x852.png');
      await app.screenshot({ path, animations: 'disabled' });
      await testInfo.attach('Lessons with iPhone bottom inset', { path, contentType: 'image/png' });
    }

    await navigate(app, 'nutrition');
    const gap = await app.locator('.nutrition-search').evaluate(element =>
      document.querySelector('.bottom-nav')!.getBoundingClientRect().top - element.getBoundingClientRect().bottom);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(8);
    await app.getByRole('button', { name: 'Next day', exact: true }).click();
    await app.getByRole('button', { name: 'Back to Today', exact: true }).click();
    await expect(app.getByTestId('calorie-total')).toContainText('938');
  }
});

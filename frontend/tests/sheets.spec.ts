import type { Locator, Page } from '@playwright/test';
import { test, expect, navigate, snapshot } from './helpers';

async function openLesson(app: Page, keyboard = false) {
  await navigate(app, 'lessons');
  const trigger = app.getByRole('button', { name: /^Training .*Build your strength foundation/ });
  if (keyboard) {
    await trigger.focus();
    await trigger.press('Enter');
  } else {
    await trigger.click();
  }
  const dialog = app.getByRole('dialog', { name: 'Lesson Notes', exact: true });
  await expect(dialog).toBeVisible();
  return { trigger, dialog, handle: dialog.getByRole('button', { name: 'Resize panel', exact: true }) };
}

async function dragHandle(app: Page, handle: Locator, distance: number) {
  await handle.evaluate(async element => {
    const sheet = element.closest('.sheet-content')!;
    await Promise.all(sheet.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await app.mouse.move(x, y);
  await app.mouse.down();
  await app.mouse.move(x, y + distance, { steps: 12 });
  // Verify movement while the pointer is still held, not just the release/click.
  const minimumMovement = Math.min(20, Math.abs(distance) / 2);
  if (distance < 0) {
    await expect.poll(async () => (await handle.boundingBox())!.y).toBeLessThan(box.y - minimumMovement);
  } else {
    await expect.poll(async () => (await handle.boundingBox())!.y).toBeGreaterThan(box.y + minimumMovement);
  }
  await app.mouse.up();
}

test('the sheet handle expands, collapses and dismisses without saving its lesson draft', async ({ app, context, browserName }, testInfo) => {
  const before = (await snapshot(app)).lessons;
  const { dialog, handle } = await openLesson(app);
  const initialHeight = (await dialog.boundingBox())!.height;
  await dialog.getByLabel('Your notes', { exact: true }).fill('Keep this draft while I resize the sheet.');

  await dragHandle(app, handle, -180);
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  expect((await dialog.boundingBox())!.height).toBeGreaterThan(initialHeight + 40);
  await dragHandle(app, handle, 140);
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByLabel('Your notes', { exact: true })).toHaveValue('Keep this draft while I resize the sheet.');

  await dragHandle(app, handle, 12);
  await expect(dialog).toBeVisible();
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  expect((await dialog.boundingBox())!.height).toBeCloseTo(initialHeight, 0);

  // Chromium's native touch protocol exercises the touch-action/capture path.
  // Both browser engines above use real mouse pointer events, not dispatched DOM events.
  if (browserName === 'chromium') {
    await handle.evaluate(async element => {
      await Promise.all(element.closest('.sheet-content')!.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    const touch = await context.newCDPSession(app);
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const upwardDistance = Math.min(160, y - 28);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 80 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect((await dialog.boundingBox())!.height).toBeCloseTo(initialHeight, 0);

    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 10; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - upwardDistance * step / 10 }] });
    }
    expect((await dialog.boundingBox())!.height).toBeGreaterThan(initialHeight + 40);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await dragHandle(app, handle, 140);
    await expect(handle).toHaveAttribute('aria-expanded', 'false');
    await touch.detach();
    testInfo.annotations.push({ type: 'touch', description: 'Native Chromium touch expansion and pointer cancellation verified.' });
  }

  await dragHandle(app, handle, 200);
  await expect(dialog).not.toBeVisible();
  expect((await snapshot(app)).lessons).toEqual(before);
  const reopened = await openLesson(app);
  await expect(reopened.handle).toHaveAttribute('aria-expanded', 'false');
  expect((await reopened.dialog.boundingBox())!.height).toBeCloseTo(initialHeight, 0);
});

test('sheet forms scroll beneath a fixed handle and retain keyboard and close controls', async ({ app, browserName }, testInfo) => {
  await app.setViewportSize({ width: 393, height: 480 });
  const { trigger, dialog, handle } = await openLesson(app, true);
  const body = dialog.locator('.sheet-body');
  const handleBefore = (await handle.boundingBox())!;
  expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const save = dialog.getByRole('button', { name: 'Save Lesson', exact: true });
  if (browserName === 'webkit') {
    // Mobile WebKit's automation API has no mouse wheel. Bring the lower form
    // control into view through the browser's actual scrolling mechanism.
    await save.scrollIntoViewIfNeeded();
    testInfo.annotations.push({ type: 'scroll', description: 'WebKit: scrollIntoView; Chromium: wheel scrolling.' });
  } else {
    const bodyBox = (await body.boundingBox())!;
    await app.mouse.move(bodyBox.x + bodyBox.width - 12, bodyBox.y + bodyBox.height / 2);
    await app.mouse.wheel(0, 500);
  }
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await handle.boundingBox())!.y).toBeCloseTo(handleBefore.y, 0);
  await expect(save).toBeVisible();

  await handle.focus();
  await handle.press('ArrowUp');
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await handle.press('ArrowDown');
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await handle.press('Enter');
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await handle.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();

  const reopened = await openLesson(app);
  await reopened.dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(reopened.dialog).not.toBeVisible();
});

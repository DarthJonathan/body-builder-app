import { test, expect, navigate, snapshot } from './helpers';

test('lesson links and notes support create, edit, completion, search, reload, and deletion', async ({ app }) => {
  await navigate(app, 'lessons');
  await app.getByRole('button', { name: 'Add lesson', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Browser test training lesson');
  await dialog.getByLabel('Lesson link', { exact: true }).fill('https://example.com/training');
  await dialog.getByLabel('Your notes', { exact: true }).fill('Remember to keep notes attached to this lesson.');
  await dialog.getByLabel('Category', { exact: true }).selectOption('Training');
  await dialog.getByRole('button', { name: 'Save Lesson', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(app.getByText('Browser test training lesson', { exact: true })).toBeVisible();

  await app.getByRole('button', { name: /Browser test training lesson/ }).first().click();
  await dialog.getByLabel('Your notes', { exact: true }).fill('Edited notes should persist through reload.');
  await dialog.getByRole('button', { name: 'Save Lesson', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await app.getByRole('button', { name: 'Complete Browser test training lesson', exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).lessons.find(item => item.title === 'Browser test training lesson')?.completed).toBe(true);
  await app.reload();
  await navigate(app, 'lessons');
  await app.getByLabel('Search your lessons', { exact: true }).fill('Browser test');
  await expect(app.getByText('Browser test training lesson', { exact: true })).toBeVisible();
  expect((await snapshot(app)).lessons.find(item => item.title === 'Browser test training lesson')?.notes).toBe('Edited notes should persist through reload.');

  await app.getByRole('button', { name: /Browser test training lesson/ }).first().click();
  await dialog.getByRole('button', { name: 'Delete Lesson', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(app.getByText('Browser test training lesson', { exact: true })).not.toBeVisible();
  expect((await snapshot(app)).lessons.some(item => item.title === 'Browser test training lesson')).toBe(false);
});

test('discovering a reading saves a personal library copy', async ({ app }) => {
  await navigate(app, 'lessons');
  const countBefore = (await snapshot(app)).lessons.length;
  await app.getByRole('button', { name: /Save .* to library/ }).filter({ hasText: /^Save$/ }).first().click();
  await expect.poll(async () => (await snapshot(app)).lessons.length).toBe(countBefore + 1);
  const saved = (await snapshot(app)).lessons.at(-1)!;
  expect(saved.url).toMatch(/^https:\/\//);
  expect(saved.source).not.toBe('');
  expect(saved.completed).toBe(false);
  await expect(app.getByText(saved.title, { exact: true }).first()).toBeVisible();
});

test('a rejected lesson URL retains the draft and never adds a library record', async ({ app }) => {
  await navigate(app, 'lessons');
  const before = (await snapshot(app)).lessons;
  await app.getByRole('button', { name: 'Add lesson', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('A link with embedded credentials');
  await dialog.getByLabel('Lesson link', { exact: true }).fill('https://user:password@example.com/training');
  await dialog.getByRole('button', { name: 'Save Lesson', exact: true }).click();
  await expect(app.getByRole('alert')).toContainText(/credentials/i);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('A link with embedded credentials');
  expect((await snapshot(app)).lessons).toEqual(before);
});

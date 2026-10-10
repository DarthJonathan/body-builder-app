import { test, expect, navigate, openCheckIn, fillCheckIn, snapshot } from './helpers';

test('mock account switching keeps private records separate and logout survives reload', async ({ app }) => {
  await openCheckIn(app);
  await fillCheckIn(app, '59.1', 'Only Nathan should see this private note.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  const originalEmail = (await snapshot(app)).profile.email;

  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  await expect(app.getByRole('dialog')).toContainText(/local preview/i);
  await app.getByRole('dialog').getByLabel('Switch preview account', { exact: true }).fill('ivana@preview.bodybuilder.app');
  await app.getByRole('button', { name: 'Switch Account', exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).profile.email).toBe('ivana@preview.bodybuilder.app');
  expect((await snapshot(app)).checkIns.some(item => item.notes === 'Only Nathan should see this private note.')).toBe(false);
  expect((await snapshot(app)).profile.role).toBe('user');

  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  await expect(app.getByRole('button', { name: 'AI Provider Settings', exact: true })).not.toBeVisible();
  await app.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(app.getByLabel('Email', { exact: true })).toBeVisible();
  await app.reload();
  await expect(app.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(app.getByRole('button', { name: 'Dashboard', exact: true })).not.toBeVisible();

  await app.getByLabel('Your name', { exact: true }).fill('Nathan');
  await app.getByLabel('Email', { exact: true }).fill(originalEmail);
  await app.getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  expect((await snapshot(app)).checkIns.some(item => item.notes === 'Only Nathan should see this private note.')).toBe(true);
});

test('the account display name persists across reload', async ({ app }) => {
  await navigate(app, 'dashboard');
  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByLabel('Display name', { exact: true }).fill('Nathan Preview');
  await dialog.getByRole('button', { name: 'Save Account', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await app.reload();
  await expect.poll(async () => (await snapshot(app)).profile.displayName).toBe('Nathan Preview');
  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  await expect(app.getByRole('dialog').getByLabel('Display name', { exact: true })).toHaveValue('Nathan Preview');
});

test('browser forward cannot restore another account’s unsaved program editor', async ({ app }) => {
  const privateName = 'Nathan private program draft';
  const before = await snapshot(app);
  await navigate(app, 'workout');
  await app.getByRole('button', { name: 'Program options', exact: true }).click();
  await app.getByLabel('Program name', { exact: true }).fill(privateName);
  await app.goBack();
  await expect(app.getByRole('button', { name: 'Workout', exact: true })).toHaveAttribute('aria-current', 'page');
  await app.getByRole('button', { name: 'Account information', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Switch preview account', { exact: true }).fill('ivana@preview.bodybuilder.app');
  await app.getByRole('button', { name: 'Switch Account', exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).profile.email).toBe('ivana@preview.bodybuilder.app');

  await app.goForward();
  await expect(app.getByRole('heading', { name: 'Edit Program', exact: true })).not.toBeVisible();
  await expect(app.getByLabel('Program name', { exact: true })).not.toBeVisible();
  expect((await snapshot(app)).profile.email).toBe('ivana@preview.bodybuilder.app');
  expect((await snapshot(app)).programs.some(program => program.name === privateName)).toBe(false);
  const nathanSaved = await app.evaluate(email => {
    const value = window.localStorage.getItem(`bodybuilder.preview.account.v1:${encodeURIComponent(email)}`);
    return JSON.parse(value!).snapshot.programs;
  }, before.profile.email);
  expect(nathanSaved).toEqual(before.programs);
  const ivana = await snapshot(app);
  const ownProgram = ivana.programs.find(program => program.id === ivana.activeProgramId)!;
  await navigate(app, 'workout');
  await app.getByRole('button', { name: 'Program options', exact: true }).click();
  await expect(app.getByLabel('Program name', { exact: true })).toHaveValue(ownProgram.name);
});

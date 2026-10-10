import { test, expect, TODAY, TOMORROW, navigate, snapshot } from './helpers';

test('an online-sourced template becomes an editable personal copy that can be scheduled', async ({ app }) => {
  await navigate(app, 'workout');
  const before = await snapshot(app);
  await app.getByRole('button', { name: 'Choose a Program', exact: true }).click();
  const templates = app.getByRole('dialog');
  const title = await templates.getByRole('heading', { level: 3 }).first().innerText();
  await templates.getByRole('button', { name: 'Use Program', exact: true }).first().click();
  await expect(templates).not.toBeVisible();
  let after = await snapshot(app);
  expect(after.programs).toHaveLength(before.programs.length + 1);
  const copied = after.programs.find(program => program.id === after.activeProgramId)!;
  expect(copied.name).toContain(title);
  expect(copied.source).toMatch(/^https:\/\//);
  expect(after.programs.find(program => program.id === before.activeProgramId)).toEqual(before.programs.find(program => program.id === before.activeProgramId));

  await app.getByRole('button', { name: 'Program options', exact: true }).click();
  await app.getByLabel('Program name', { exact: true }).fill('My browser-tested program');
  await app.getByRole('button', { name: 'Rename workout', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Workout name', { exact: true }).fill('Strength Day A');
  await app.getByRole('dialog').getByRole('button', { name: 'Save Workout Name', exact: true }).click();
  await app.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await app.getByRole('dialog').getByLabel('Search exercises', { exact: true }).fill('Dead Bug');
  await app.getByRole('dialog').getByRole('button', { name: /Dead Bug/ }).click();
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).programs.find(program => program.id === copied.id)?.name).toBe('My browser-tested program');

  await app.getByRole('button', { name: 'Options for Sat workout', exact: true }).click();
  await app.getByRole('dialog').getByRole('button', { name: 'Strength Day A', exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  after = await snapshot(app);
  const edited = after.programs.find(program => program.id === copied.id)!;
  expect(edited.workouts[0].exercises).toHaveLength(copied.workouts[0].exercises.length + 1);
  expect(after.schedule.find(entry => entry.date === TOMORROW)?.workoutId).toBe(edited.workouts[0].id);
  expect(after.schedule.find(entry => entry.date === TODAY)).toBeDefined();
  await app.reload();
  await navigate(app, 'workout');
  await expect(app.getByText('My browser-tested program', { exact: true })).toBeVisible();
  expect((await snapshot(app)).programs.find(program => program.id === before.activeProgramId)).toEqual(before.programs.find(program => program.id === before.activeProgramId));
});

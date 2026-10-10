import { test, expect, TODAY, openTodayWorkout, navigate, snapshot } from './helpers';

test('workout logging separates effort from completion and restores set edits after refresh', async ({ app }) => {
  await openTodayWorkout(app);
  await expect(app.getByRole('heading', { name: /^Lower 2/ })).toBeVisible();
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();

  const weight = app.getByLabel('Barbell Deadlift set 1 weight', { exact: true });
  const reps = app.getByLabel('Barbell Deadlift set 1 reps', { exact: true });
  await weight.fill('42.5');
  await reps.fill('8');
  await app.getByLabel('NOTES', { exact: true }).first().fill('Keep the bar close on the next set.');
  await app.getByRole('button', { name: 'Effort for Barbell Deadlift set 1', exact: true }).click();
  await app.getByRole('button', { name: /^Hard/ }).click();

  await expect.poll(async () => (await snapshot(app)).sessions.find(session => !session.finishedAt)?.exercises[0].sets[0].effort)
    .toBe('hard');
  let stored = (await snapshot(app)).sessions.find(session => !session.finishedAt)!;
  expect(stored.exercises[0].sets[0]).toEqual(expect.objectContaining({ weight: 42.5, reps: 8, effort: 'hard', completed: false }));
  expect(stored.exercises[0].notes).toBe('Keep the bar close on the next set.');
  await app.getByRole('button', { name: 'Add Set', exact: true }).first().click();
  await expect.poll(async () => (await snapshot(app)).sessions.find(session => !session.finishedAt)?.exercises[0].sets.length).toBe(4);

  await app.getByRole('button', { name: 'Complete Barbell Deadlift set 1', exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).sessions.find(session => !session.finishedAt)?.exercises[0].sets[0].completed)
    .toBe(true);
  await app.reload();
  await expect(app.getByLabel('Barbell Deadlift set 1 weight', { exact: true })).toHaveValue('42.5');
  await expect(app.getByLabel('Barbell Deadlift set 1 reps', { exact: true })).toHaveValue('8');
  await expect(app.getByLabel('NOTES', { exact: true }).first()).toHaveValue('Keep the bar close on the next set.');
  await expect(app.getByLabel('Barbell Deadlift set 4 reps', { exact: true })).toBeVisible();

  await app.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect.poll(async () => (await snapshot(app)).sessions.filter(session => session.date === TODAY && session.finishedAt).length).toBe(1);
  stored = (await snapshot(app)).sessions.find(session => session.date === TODAY && session.finishedAt)!;
  expect(stored.exercises[0].sets[0]).toEqual(expect.objectContaining({ weight: 42.5, reps: 8, effort: 'hard', completed: true }));
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await navigate(app, 'progress');
  await app.getByRole('button', { name: /WORKOUTS/ }).click();
  await app.getByRole('button', { name: 'View Workout History', exact: true }).click();
  await expect(app.getByText('Lower 2', { exact: true }).first()).toBeVisible();
});

test('rest deadlines survive reload and recover when the deadline has passed', async ({ app }) => {
  await openTodayWorkout(app);
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await app.getByRole('button', { name: /^Rest:/ }).first().click();
  await app.getByRole('dialog').getByRole('button', { name: 'Start Rest Timer', exact: true }).click();
  await expect.poll(async () => Boolean((await snapshot(app)).sessions.find(session => !session.finishedAt)?.restDeadline)).toBe(true);
  const deadline = (await snapshot(app)).sessions.find(session => !session.finishedAt)!.restDeadline;
  const duration = (await snapshot(app)).sessions.find(session => !session.finishedAt)!.restDuration;

  await app.reload();
  expect((await snapshot(app)).sessions.find(session => !session.finishedAt)?.restDeadline).toBe(deadline);
  await expect(app.getByTestId('rest-countdown')).toBeVisible();
  await app.clock.fastForward((duration + 1) * 1_000);
  await expect(app.getByTestId('rest-countdown')).not.toBeVisible();
  await expect(app.getByRole('button', { name: /^Rest:/ }).first()).toBeVisible();
});

test('browser back and forward preserve workout details and an active session draft', async ({ app }) => {
  await openTodayWorkout(app);
  await app.goBack();
  await expect(app.getByRole('button', { name: 'Workout', exact: true })).toHaveAttribute('aria-current', 'page');
  await app.goForward();
  await expect(app.getByRole('heading', { name: /^Lower 2/ })).toBeVisible();
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await app.getByLabel('Barbell Deadlift set 1 weight', { exact: true }).fill('35');
  await app.getByLabel('Barbell Deadlift set 1 reps', { exact: true }).fill('6');
  await app.getByRole('button', { name: 'Effort for Barbell Deadlift set 1', exact: true }).click();
  await app.getByRole('button', { name: /^Easy/ }).click();
  await expect.poll(async () => (await snapshot(app)).sessions.find(session => !session.finishedAt)?.exercises[0].sets[0].reps).toBe(6);

  await app.goBack();
  await expect(app.getByRole('button', { name: 'Resume Workout', exact: true })).toBeVisible();
  await app.goForward();
  await expect(app.getByLabel('Barbell Deadlift set 1 weight', { exact: true })).toHaveValue('35');
  await expect(app.getByLabel('Barbell Deadlift set 1 reps', { exact: true })).toHaveValue('6');
  await app.reload();
  await expect(app.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  await expect(app.getByLabel('Barbell Deadlift set 1 weight', { exact: true })).toHaveValue('35');
});

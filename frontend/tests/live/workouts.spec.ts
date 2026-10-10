import { test, expect, registerAccount, signIn, backendSnapshot, createAndScheduleTemplate, navigate, today } from './helpers';
import type { Route } from '@playwright/test';
import { addedProgramCases } from '../program-cases';

test('personal templates, calendar assignments and workout logs persist across real devices', async ({ app, secondDevice }, testInfo) => {
  const account = await registerAccount(app, testInfo, 'workout');
  await createAndScheduleTemplate(app, account.token);
  let state = await backendSnapshot(app, account.token);
  expect(state.programs[0].id).not.toBe('upper-lower-4');
  expect(state.programs[0].source).toMatch(/^https:\/\//);
  expect(state.schedule).toHaveLength(1);
  const originalProgram = state.programs[0];
  await app.getByRole('button', { name: 'Program options', exact: true }).click();
  await app.getByLabel('Program name', { exact: true }).fill('My real strength program');
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).programs[0]?.name).toBe('My real strength program');
  await app.getByRole('button', { name: 'Get Started', exact: true }).click();
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  const weight = app.getByLabel('Barbell Bench Press set 1 weight', { exact: true });
  const reps = app.getByLabel('Barbell Bench Press set 1 reps', { exact: true });
  await expect(reps).toBeVisible();
  await weight.fill('35');
  await reps.fill('8');
  await app.getByRole('button', { name: 'Effort for Barbell Bench Press set 1', exact: true }).click();
  await app.getByRole('button', { name: /^Hard/ }).click();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).sessions[0]?.exercises[0].sets[0].effort).toBe('hard');
  state = await backendSnapshot(app, account.token);
  expect(state.sessions[0].exercises[0].sets[0]).toEqual(expect.objectContaining({ weight: 35, reps: 8, effort: 'hard', completed: false }));
  expect(state.sessions[0].exercises[0].prescription).toEqual(originalProgram.workouts[0].exercises[0]);
  await app.getByRole('button', { name: 'Complete Barbell Bench Press set 1', exact: true }).click();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).sessions[0]?.exercises[0].sets[0].completed).toBe(true);
  await app.reload();
  await expect(reps).toHaveValue('8');
  await expect(weight).toHaveValue('35');
  await signIn(secondDevice, account);
  await expect(secondDevice.getByLabel('Barbell Bench Press set 1 reps', { exact: true })).toHaveValue('8');
  await app.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect.poll(async () => Boolean((await backendSnapshot(app, account.token)).sessions[0]?.finishedAt)).toBe(true);
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await navigate(app, 'Progress');
  const finished = (await backendSnapshot(app, account.token)).sessions[0];
  expect(finished.exercises[0].sets[0].completed).toBe(true);
  expect(finished.exercises[0].sets[0].effort).toBe('hard');
  await secondDevice.reload();
  expect((await backendSnapshot(secondDevice, account.token)).sessions[0].finishedAt).toBe(finished.finishedAt);
});

test('expanded programs save provenance and prescriptions through Go and sync to a second device', async ({ app, secondDevice }, testInfo) => {
  const account = await registerAccount(app, testInfo, 'program-library');
  await createAndScheduleTemplate(app, account.token);
  const initial = await backendSnapshot(app, account.token);
  for (const { template } of addedProgramCases) {
    await app.getByRole('button', { name: 'Choose a Program', exact: true }).click();
    const card = app.getByRole('dialog').locator('article').filter({ has: app.getByRole('heading', { name: template.name, exact: true }) });
    await expect(card).toContainText(template.adaptationNote!);
    await card.getByRole('button', { name: 'Use Program', exact: true }).click();
    await expect(app.getByRole('dialog')).not.toBeVisible();
    const state = await backendSnapshot(app, account.token);
    const copy = state.programs.find(program => program.id === state.activeProgramId)!;
    expect(copy).toEqual(expect.objectContaining({ name: template.name, source: template.source, sourceName: template.sourceName, sourceReviewedAt: template.sourceReviewedAt, adaptationNote: template.adaptationNote }));
    expect(copy.workouts.map(w => w.exercises.map(p => ({ ...p, id: '', superset: Boolean(p.superset) })))).toEqual(template.workouts.map(w => w.exercises.map(p => ({ ...p, id: '', superset: Boolean(p.superset) }))));
    expect(state.schedule).toEqual(initial.schedule);
    expect(state.programs.find(program => program.id === initial.activeProgramId)).toEqual(initial.programs[0]);
  }
  // Schedule the last chosen plan explicitly, then verify an edited private copy
  // survives both PostgreSQL storage and authentication on another device.
  let state = await backendSnapshot(app, account.token);
  const copy = state.programs.find(program => program.id === state.activeProgramId)!;
  await app.getByRole('button', { name: 'Program options', exact: true }).click();
  await app.getByLabel('Program name', { exact: true }).fill('My saved dumbbell plan');
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).programs.find(p => p.id === copy.id)?.name).toBe('My saved dumbbell plan');
  const date = await today(app);
  const weekday = await app.evaluate(date => new Date(`${date}T12:00:00`).toLocaleDateString('en', { weekday: 'short' }), date);
  await app.getByRole('button', { name: `Options for ${weekday} workout`, exact: true }).click();
  await app.getByRole('dialog').getByRole('button', { name: copy.workouts[0].name, exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await app.reload();
  await navigate(app, 'Workout');
  await expect(app.getByText('My saved dumbbell plan', { exact: true })).toBeVisible();
  state = await backendSnapshot(app, account.token);
  expect(state.programs).toHaveLength(6);
  expect(state.schedule.find(entry => entry.date === date)?.workoutId).toBe(copy.workouts[0].id);
  expect(state.programs.find(p => p.id === copy.id)?.adaptationNote).toBe(copy.adaptationNote);
  await signIn(secondDevice, account);
  await navigate(secondDevice, 'Workout');
  await expect(secondDevice.getByText('My saved dumbbell plan', { exact: true })).toBeVisible();
  expect((await backendSnapshot(secondDevice, account.token)).programs).toEqual(state.programs);
  expect((await backendSnapshot(secondDevice, account.token)).schedule).toEqual(state.schedule);

  const glute = state.programs.find(p => p.name === '3-Day Glute Focus')!;
  await app.getByRole('button', { name: 'Choose a Program', exact: true }).click();
  await app.getByRole('dialog').getByRole('button', { name: glute.name, exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await app.getByRole('button', { name: `Options for ${weekday} workout`, exact: true }).click();
  await app.getByRole('dialog').getByRole('button', { name: glute.workouts[2].name, exact: true }).click();
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await app.getByRole('button', { name: 'Get Started', exact: true }).click();
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  const duration = app.getByLabel('Bodyweight Glute Bridge set 1 seconds', { exact: true });
  await duration.fill('20');
  await expect(app.getByLabel('Bodyweight Glute Bridge set 1 weight', { exact: true })).toHaveCount(0);
  await app.getByRole('button', { name: 'Effort for Bodyweight Glute Bridge set 1', exact: true }).click();
  await app.getByRole('button', { name: /^Medium/ }).click();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).sessions[0]?.exercises[0].sets[0].reps).toBe(20);
  expect((await backendSnapshot(app, account.token)).sessions[0].exercises[0].prescription.seconds).toBe(true);
  await app.reload();
  await expect(duration).toHaveValue('20');
  await secondDevice.reload();
  await expect(secondDevice.getByLabel('Bodyweight Glute Bridge set 1 seconds', { exact: true })).toHaveValue('20');
});

test('saving reps during an effort tap keeps the control in place and opens its picker', async ({ app }, testInfo) => {
  const account = await registerAccount(app, testInfo, 'effort-save');
  await createAndScheduleTemplate(app, account.token);
  await app.getByRole('button', { name: 'Get Started', exact: true }).click();
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).sessions.length).toBe(1);
  await expect(app.getByTestId('sync-status')).not.toBeVisible();
  const reps = app.getByLabel('Barbell Bench Press set 1 reps', { exact: true });
  const effort = app.getByRole('button', { name: 'Effort for Barbell Bench Press set 1', exact: true });
  await reps.fill('8');
  const before = await effort.boundingBox();
  expect(before).not.toBeNull();

  let releaseSave!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  let saveHeld = false;
  const holdSave = async (route: Route) => {
    if (!saveHeld && route.request().method() === 'POST'
      && route.request().postDataJSON()?.operation === 'saveSession') {
      saveHeld = true;
      // Pause the request, then forward it unchanged to the real Go API.
      await saveGate;
    }
    await route.continue();
  };
  await app.route('**/api/v1/mutations', holdSave);
  try {
    await app.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await app.mouse.down(); // Blurs the reps input and starts its save.
    await expect.poll(() => saveHeld).toBe(true);
    await expect(app.getByTestId('sync-status')).toContainText('Syncing changes');
    const during = await effort.boundingBox();
    expect(during).not.toBeNull();
    expect(during!.x).toBeCloseTo(before!.x, 0);
    expect(during!.y).toBeCloseTo(before!.y, 0);
    await app.mouse.up();
    await expect(app.getByRole('dialog')).toBeVisible();
    await expect(app.getByRole('dialog').getByRole('button', { name: /^Hard/ })).toBeVisible();
  } finally {
    await app.mouse.up();
    releaseSave();
    await app.unroute('**/api/v1/mutations', holdSave);
  }
  await app.getByRole('dialog').getByRole('button', { name: /^Hard/ }).click();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).sessions[0]?.exercises[0].sets[0]).toEqual(
    expect.objectContaining({ reps: 8, effort: 'hard' })
  );
});

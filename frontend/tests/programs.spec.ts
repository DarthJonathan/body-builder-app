import { test, expect, TODAY, TOMORROW, navigate, snapshot, assertNoHorizontalOverflow } from './helpers';
import { addedProgramCases } from './program-cases';

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

for (const { template, previewIndex, workout, exercise } of addedProgramCases) {
  test(`new starter ${template.name} can be chosen, scheduled, previewed and restored`, async ({ app }, testInfo) => {
    await navigate(app, 'workout');
    const before = await snapshot(app);
    await app.getByRole('button', { name: 'Choose a Program', exact: true }).click();
    const dialog = app.getByRole('dialog');
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(17);
    const card = dialog.locator('article').filter({ has: app.getByRole('heading', { name: template.name, exact: true }) });
    await expect(card.getByRole('link', { name: 'View source' })).toHaveAttribute('href', template.source);
    await expect(card).toContainText(template.sourceName!);
    await expect(card).toContainText(template.adaptationNote!);
    if (template.id === 'phul-4') {
      await card.scrollIntoViewIfNeeded();
      await assertNoHorizontalOverflow(app);
      await testInfo.attach('gym-program-chooser', { body: await app.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    }
    await card.getByRole('button', { name: 'Use Program', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    let state = await snapshot(app);
    const copy = state.programs.find(program => program.id === state.activeProgramId)!;
    expect(copy).toEqual(expect.objectContaining({ name: template.name, source: template.source, sourceName: template.sourceName, sourceReviewedAt: template.sourceReviewedAt, adaptationNote: template.adaptationNote }));
    expect(state.schedule).toEqual(before.schedule);
    expect(state.sessions).toEqual(before.sessions);
    expect(copy.workouts[previewIndex].exercises.map(p => ({ ...p, id: '', superset: Boolean(p.superset) }))).toEqual(workout.exercises.map(p => ({ ...p, id: '', superset: Boolean(p.superset) })));

    await app.getByRole('button', { name: 'Options for Fri workout', exact: true }).click();
    await app.getByRole('dialog').getByRole('button', { name: workout.name, exact: true }).click();
    await expect(app.getByRole('dialog')).not.toBeVisible();
    state = await snapshot(app);
    expect(state.schedule.find(entry => entry.date === TODAY)?.workoutId).toBe(copy.workouts[previewIndex].id);
    await app.getByRole('button', { name: 'Get Started', exact: true }).click();
    await expect(app.locator('.detail-header h1')).toContainText(workout.name);
    const movement = app.locator('.preview-exercise-main').filter({ hasText: exercise.name }).first();
    const prescription = workout.exercises[0];
    if (prescription.seconds) await expect(movement).toContainText('15–30 second holds');
    if (prescription.repsMin === prescription.repsMax) {
      await expect(movement).toContainText(`${prescription.repsMin} reps`);
      await expect(movement).not.toContainText(`${prescription.repsMin}–${prescription.repsMin}`);
    }
    const image = movement.locator('img.exercise-image');
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveAttribute('src', exercise.image);
    if (template.id === 'glute-focus-3' || template.id === 'phul-4') {
      await app.clock.fastForward(4000);
      await testInfo.attach(`${template.id}-preview`, { body: await app.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    }
    await movement.click();
    await expect(app.getByRole('dialog').locator('.guide-steps li')).toHaveCount(exercise.instructions.length);
    await expect(app.getByRole('dialog').getByRole('link', { name: 'Exercise source', exact: true })).toHaveAttribute('href', exercise.source!);
    await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await app.getByRole('button', { name: 'Back to workouts', exact: true }).click();
    await app.reload();
    await navigate(app, 'workout');
    await expect(app.getByText(template.name, { exact: true })).toBeVisible();
    expect((await snapshot(app)).programs.find(program => program.id === copy.id)).toEqual(copy);
    expect((await snapshot(app)).programs.find(program => program.id === before.activeProgramId)).toEqual(before.programs.find(program => program.id === before.activeProgramId));
    if (prescription.seconds) {
      await app.getByRole('button', { name: 'Get Started', exact: true }).click();
      await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
      const duration = app.getByLabel(`${exercise.name} set 1 seconds`, { exact: true });
      await expect(duration).toBeVisible();
      await expect(app.getByLabel(`${exercise.name} set 1 weight`, { exact: true })).toHaveCount(0);
      await expect(app.locator('.session-exercise').first().locator('.set-table-heading')).toContainText('SEC');
      await duration.fill('20');
      await app.getByRole('button', { name: `Effort for ${exercise.name} set 1`, exact: true }).click();
      await app.getByRole('button', { name: /^Medium/ }).click();
      await expect.poll(async () => (await snapshot(app)).sessions.find(s => !s.finishedAt)?.exercises[0].sets[0].reps).toBe(20);
      await app.reload();
      await expect(duration).toHaveValue('20');
    }
  });
}

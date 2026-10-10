import type {
  AppSnapshot, CheckIn, Effort, FoodEntry, Lesson, LoggedSet, Muscle,
  NutritionTargets, Prescription, Profile, Program, ProviderConfig,
  WeightEntry, Workout, WorkoutSession
} from '../domain';
import { invalid } from './errors';
import { calculateNutritionTargets, CALCULATION_VERSION, validateTargetCalculation } from '../nutrition';

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

export function string(value: unknown, label: string, max = 200, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    invalid(`${label} ${allowEmpty ? 'must be text' : 'is required'}${max ? ` (up to ${max} characters)` : ''}.`);
  }
}

export function identifier(value: unknown, label = 'Record ID'): asserts value is string {
  string(value, label, 180);
}

export function number(value: unknown, label: string, min = 0, max = 100_000, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    invalid(`${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
  }
}

export function bool(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') invalid(`${label} must be true or false.`);
}

export function choice<T extends string>(value: unknown, options: readonly T[], label: string): asserts value is T {
  if (typeof value !== 'string' || !options.includes(value as T)) invalid(`${label} has an invalid value.`);
}

export function date(value: unknown, label = 'Date'): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${label} must be a calendar date.`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(`${label} is not a valid calendar date.`);
}

export function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid(`${label} must be a valid timestamp.`);
  }
}

export function list(value: unknown, label: string, max = 100): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} must contain at most ${max} records.`);
}

export function unique(values: { id: string }[], label: string) {
  if (new Set(values.map(value => value.id)).size !== values.length) invalid(`${label} contains duplicate IDs.`);
}

export function email(value: unknown): string {
  string(value, 'Email address', 254);
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) invalid('Enter a valid email address.');
  return normalized;
}

export function nutrients(value: unknown, label = 'Nutrition') {
  const data = record(value, label);
  number(data.calories, `${label} calories`, 0, 100_000);
  number(data.protein, `${label} protein`, 0, 10_000);
  number(data.carbs, `${label} carbs`, 0, 10_000);
  number(data.fat, `${label} fat`, 0, 10_000);
}

export function profile(value: unknown): asserts value is Profile {
  const data = record(value, 'Profile');
  identifier(data.id); string(data.displayName, 'Display name', 80); email(data.email);
  string(data.timezone, 'Timezone', 100);
  try { new Intl.DateTimeFormat('en', { timeZone: data.timezone as string }); } catch { invalid('Choose a valid timezone.'); }
  choice(data.unit, ['kg', 'lb'], 'Weight unit');
  choice(data.goal, ['build-muscle', 'maintain', 'lose-fat'], 'Goal');
  number(data.startWeight, 'Starting weight', 1, 700); date(data.goalStartedAt, 'Goal start date');
  choice(data.role, ['admin', 'user'], 'Account role');
}

export function muscle(value: unknown): asserts value is Muscle {
  const data = record(value, 'Muscle');
  identifier(data.id); string(data.name, 'Muscle name', 80); string(data.image, 'Muscle image', 2_000, true);
  if (data.percentage !== undefined) number(data.percentage, 'Muscle percentage', 0, 100);
}

export function prescription(value: unknown): asserts value is Prescription {
  const data = record(value, 'Prescription');
  identifier(data.id); identifier(data.exerciseId, 'Exercise ID');
  number(data.sets, 'Sets', 1, 100, true); number(data.repsMin, 'Minimum reps', 0, 10_000, true);
  number(data.repsMax, 'Maximum reps', 1, 10_000, true);
  if ((data.repsMax as number) < (data.repsMin as number)) invalid('Maximum reps must be at least the minimum reps.');
  number(data.restSeconds, 'Rest duration', 0, 3_600, true);
  if (data.perSide !== undefined) bool(data.perSide, 'Per-side prescription');
  if (data.seconds !== undefined) bool(data.seconds, 'Timed prescription');
  if (data.amrapLast !== undefined) bool(data.amrapLast, 'Final AMRAP set');
  // An empty select value represents “None” in the program editor.
  if (data.superset !== undefined) string(data.superset, 'Superset ID', 180, true);
}

export function workout(value: unknown): asserts value is Workout {
  const data = record(value, 'Workout');
  identifier(data.id); string(data.name, 'Workout name', 150);
  list(data.muscles, 'Target muscles', 30); data.muscles.forEach(muscle);
  list(data.exercises, 'Exercises', 100); data.exercises.forEach(prescription);
  unique(data.exercises as Prescription[], 'Exercise prescriptions');
  list(data.warmup, 'Warm-up instructions', 30); data.warmup.forEach(item => string(item, 'Warm-up instruction', 1_000));
}

export function program(value: unknown): asserts value is Program {
  const data = record(value, 'Program');
  identifier(data.id); string(data.name, 'Program name', 150); string(data.level, 'Program level', 80);
  choice(data.goal, ['build-muscle', 'maintain', 'lose-fat'], 'Program goal');
  list(data.workouts, 'Workouts', 30); data.workouts.forEach(workout); unique(data.workouts as Workout[], 'Workouts');
  if (!data.workouts.length) invalid('Add at least one workout to your program.');
  if (data.source !== undefined) string(data.source, 'Program source', 2_000, true);
  if (data.sourceName !== undefined) string(data.sourceName, 'Program source name', 150, true);
  if (data.sourceReviewedAt !== undefined) date(data.sourceReviewedAt, 'Program source review date');
  if (data.adaptationNote !== undefined) string(data.adaptationNote, 'Program adaptation note', 2_000, true);
}

export function loggedSet(value: unknown): asserts value is LoggedSet {
  const data = record(value, 'Set');
  identifier(data.id); number(data.weight, 'Set weight', 0, 2_000);
  number(data.reps, 'Set reps or seconds', 0, 10_000, true); bool(data.completed, 'Set completion');
  if (data.effort !== null) choice(data.effort, ['easy', 'medium', 'hard'] satisfies Exclude<Effort, null>[], 'Set effort');
}

export function session(value: unknown): asserts value is WorkoutSession {
  const data = record(value, 'Workout session');
  identifier(data.id); identifier(data.workoutId, 'Workout ID'); string(data.name, 'Session name', 150);
  date(data.date); timestamp(data.startedAt, 'Start time');
  if (data.finishedAt !== null) timestamp(data.finishedAt, 'Finish time');
  if (data.finishedAt !== null && Date.parse(data.finishedAt as string) < Date.parse(data.startedAt as string)) invalid('Finish time must follow the start time.');
  if (data.restDeadline !== null) timestamp(data.restDeadline, 'Rest deadline');
  number(data.restDuration, 'Rest duration', 0, 3_600, true);
  list(data.exercises, 'Session exercises', 100);
  for (const item of data.exercises) {
    const exercise = record(item, 'Session exercise');
    identifier(exercise.id); identifier(exercise.exerciseId, 'Exercise ID'); prescription(exercise.prescription);
    if (exercise.exerciseId !== (exercise.prescription as Prescription).exerciseId) invalid('The session exercise and prescription do not match.');
    string(exercise.notes, 'Exercise notes', 5_000, true); list(exercise.sets, 'Logged sets', 100);
    exercise.sets.forEach(loggedSet); unique(exercise.sets as LoggedSet[], 'Logged sets');
  }
  unique(data.exercises as { id: string }[], 'Session exercises');
}

export function foodEntry(value: unknown): asserts value is FoodEntry {
  const data = record(value, 'Food entry');
  identifier(data.id); string(data.name, 'Food name', 200); date(data.date);
  choice(data.meal, ['Breakfast', 'Lunch', 'Dinner', 'Snacks'], 'Meal');
  number(data.quantity, 'Serving quantity', 0.001, 10_000); string(data.serving, 'Serving', 150);
  choice(data.source, ['database', 'manual', 'ai-estimate'], 'Food source');
  if (data.foodId !== undefined) identifier(data.foodId, 'Food ID');
  if (data.databaseSource !== undefined) string(data.databaseSource, 'Database source', 1_000, true);
  nutrients(data);
}

export function targets(value: unknown, requireCalculatedMetadata = false): asserts value is NutritionTargets {
  const data = record(value, 'Nutrition targets');
  identifier(data.id); date(data.effectiveDate, 'Target date'); nutrients(data, 'Target');
  number(data.calories, 'Calorie target', 1, 20_000);
  choice(data.mode, ['manual', 'calculated'], 'Target mode'); bool(data.manuallyOverridden, 'Manual override');
  if (data.mode === 'calculated' && data.manuallyOverridden) invalid('Calculated targets cannot be marked as a manual override.');
  if (data.calculation === undefined) {
    if (requireCalculatedMetadata && data.mode === 'calculated') invalid('New calculated targets require their calculation inputs.');
    return;
  }
  const calculation = record(data.calculation, 'Target calculation');
  if (calculation.version !== CALCULATION_VERSION) invalid('The calculation version is unsupported.');
  let expected: NutritionTargets;
  try { validateTargetCalculation(calculation.input); expected = calculateNutritionTargets(calculation.input, data.id as string); }
  catch (error) { invalid(error instanceof Error ? error.message : 'Calculation inputs are invalid.'); }
  if (calculation.restingCalories !== expected!.calculation!.restingCalories || calculation.maintenanceCalories !== expected!.calculation!.maintenanceCalories) invalid('Calculation provenance does not match its inputs.');
  if (data.mode === 'calculated') {
    if (data.effectiveDate !== expected!.effectiveDate || (['calories', 'protein', 'carbs', 'fat'] as const).some(key => data[key] !== expected![key])) invalid('Calculated targets do not match their inputs. Calculate them again.');
  } else if (!data.manuallyOverridden) invalid('Edited calculated targets must be marked as a manual override.');
}

export function checkIn(value: unknown): asserts value is CheckIn {
  const data = record(value, 'Check-in');
  identifier(data.id); date(data.date); number(data.weight, 'Weight in kg', 1, 700);
  string(data.notes, 'Check-in notes', 5_000, true);
}

export function weight(value: unknown): asserts value is WeightEntry {
  const data = record(value, 'Weight entry');
  identifier(data.id); date(data.date); number(data.weight, 'Weight in kg', 1, 700);
}

export function lesson(value: unknown): asserts value is Lesson {
  const data = record(value, 'Lesson');
  identifier(data.id); string(data.title, 'Lesson title', 200); string(data.url, 'Lesson link', 2_000);
  let parsed: URL;
  try { parsed = new URL(data.url as string); } catch { invalid('Enter a complete lesson link, beginning with https:// or http://.'); }
  if (!['https:', 'http:'].includes(parsed!.protocol) || parsed!.username || parsed!.password) invalid('Lesson links must use https:// or http:// without credentials.');
  string(data.notes, 'Lesson notes', 10_000, true); string(data.category, 'Lesson category', 100);
  string(data.source, 'Lesson source', 150, true); bool(data.completed, 'Lesson completion'); timestamp(data.savedAt, 'Saved time');
}

export function provider(value: unknown): asserts value is ProviderConfig {
  const data = record(value, 'Provider configuration');
  choice(data.provider, ['openai', 'anthropic', 'openrouter'], 'AI provider');
  string(data.model, 'Model', 150, true); bool(data.enabled, 'Provider enabled'); bool(data.configured, 'Provider configured');
  if (data.enabled && !(data.model as string).trim()) invalid('Enter a model name before enabling the provider.');
  if (Object.keys(data).some(key => !['provider', 'model', 'enabled', 'configured'].includes(key))) {
    invalid('Preview provider settings only accept provider, model, enabled, and configured fields. Do not enter a real API key.');
  }
}

export function snapshot(value: unknown): asserts value is AppSnapshot {
  const data = record(value, 'Saved preview'); profile(data.profile); identifier(data.activeProgramId, 'Active program ID');
  list(data.programs, 'Programs', 100); data.programs.forEach(program); unique(data.programs as Program[], 'Programs');
  if (!(data.programs as Program[]).some(item => item.id === data.activeProgramId)) invalid('The saved active program is unavailable.');
  list(data.schedule, 'Schedule', 5_000);
  for (const item of data.schedule) {
    const entry = record(item, 'Scheduled workout'); identifier(entry.id); date(entry.date);
    if (entry.workoutId !== null) identifier(entry.workoutId, 'Scheduled workout ID');
  }
  list(data.sessions, 'Sessions', 5_000); data.sessions.forEach(session);
  list(data.foodEntries, 'Food entries', 20_000); data.foodEntries.forEach(foodEntry);
  list(data.targets, 'Nutrition targets', 5_000); data.targets.forEach(item => targets(item));
  list(data.checkIns, 'Check-ins', 5_000); data.checkIns.forEach(checkIn);
  list(data.weights, 'Weight entries', 5_000); data.weights.forEach(weight);
  list(data.lessons, 'Lessons', 5_000); data.lessons.forEach(lesson); provider(data.provider);
  for (const key of ['schedule', 'sessions', 'foodEntries', 'targets', 'checkIns', 'weights', 'lessons'] as const) {
    unique(data[key] as { id: string }[], key);
  }
  for (const key of ['schedule', 'checkIns', 'weights'] as const) {
    const entries = data[key] as { date: string }[];
    if (new Set(entries.map(item => item.date)).size !== entries.length) invalid(`Saved ${key} contains duplicate dates.`);
  }
}

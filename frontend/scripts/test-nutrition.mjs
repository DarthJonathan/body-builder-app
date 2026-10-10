import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const output = await mkdtemp(path.join(tmpdir(), 'bodybuilder-nutrition-'));
const fixtures = JSON.parse(await readFile(new URL('../../docs/fixtures/nutrition-calculation.json', import.meta.url), 'utf8'));

try {
  await promisify(execFile)(process.execPath, [
    require.resolve('typescript/bin/tsc'), 'src/lib/nutrition.ts',
    '--outDir', output, '--module', 'commonjs', '--target', 'ES2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--strict', '--lib', 'ES2022,DOM'
  ], { cwd: frontend, timeout: 30_000 });
  await writeFile(path.join(output, 'package.json'), '{"type":"commonjs"}\n');
  const compiled = createRequire(path.join(output, 'tests.cjs'));
  const { CALCULATION_VERSION, calculateNutritionTargets } = compiled('./nutrition.js');
  assert.equal(CALCULATION_VERSION, fixtures.version);
  const base = structuredClone(fixtures.cases[0].input);

  for (const sample of fixtures.cases) {
    await test(`Go/TypeScript golden: ${sample.name}`, () => {
      const input = structuredClone(sample.input);
      const result = calculateNutritionTargets(input, 'fixture-preview');
      assert.deepEqual({
        calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat,
        restingCalories: result.calculation.restingCalories,
        maintenanceCalories: result.calculation.maintenanceCalories
      }, sample.expected);
      assert.equal(result.id, 'fixture-preview');
      assert.equal(result.effectiveDate, input.effectiveDate);
      assert.equal(result.mode, 'calculated');
      assert.equal(result.manuallyOverridden, false);
      assert.equal(result.calculation.version, fixtures.version);
      assert.deepEqual(result.calculation.input, sample.input);
      assert.deepEqual(input, sample.input, 'preview must not edit the input');
      input.weightKg += 1;
      assert.deepEqual(result.calculation.input, sample.input, 'saved provenance must not share an editable input');
    });
  }

  await test('every personal input and app setting must be explicitly provided', () => {
    for (const field of Object.keys(base)) {
      const missing = { ...base };
      delete missing[field];
      assert.throws(() => calculateNutritionTargets(missing, 'preview'), field);
      assert.throws(() => calculateNutritionTargets({ ...base, [field]: null }, 'preview'), field);
    }
    assert.doesNotThrow(() => calculateNutritionTargets({ ...base, calorieAdjustment: 0 }, 'preview'));
    for (const input of [null, [], { ...base, unsupported: true }]) {
      assert.throws(() => calculateNutritionTargets(input, 'preview'));
    }
  });

  await test('invalid values, units, dates and non-finite numbers are rejected', () => {
    const badFields = {
      age: [17, 101, 30.5, '30'], sex: ['unknown', ''], heightCm: [99, 251], weightKg: [29, 351],
      activity: ['unselected', '__proto__'], goal: ['unselected', 'toString'],
      effectiveDate: ['2026-02-30', '2026-13-01', '2026-1-01', 'not-a-date'],
      calorieAdjustment: [-501, 501], proteinPerKg: [0.79, 3.01], fatPercent: [14, 41]
    };
    for (const [field, values] of Object.entries(badFields)) {
      for (const value of values) assert.throws(() => calculateNutritionTargets({ ...base, [field]: value }, 'preview'), `${field}=${value}`);
    }
    for (const field of ['age', 'heightCm', 'weightKg', 'calorieAdjustment', 'proteinPerKg', 'fatPercent']) {
      for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => calculateNutritionTargets({ ...base, [field]: value }, 'preview'), field);
    }
  });

  await test('out-of-range calorie estimates and impossible macro allocations are not clamped', () => {
    assert.throws(() => calculateNutritionTargets({ ...base, age: 100, heightCm: 100, weightKg: 30, activity: 'sedentary', calorieAdjustment: -500 }, 'preview'), /1,000/);
    assert.throws(() => calculateNutritionTargets({ ...base, age: 60, heightCm: 100, weightKg: 110, activity: 'moderate', calorieAdjustment: 0, proteinPerKg: 3, fatPercent: 40 }, 'preview'), /more than the calorie target/);
  });

  await test('valid limits and leap dates keep the declared calculation policy', () => {
    const highest = calculateNutritionTargets({ ...base, age: 18, heightCm: 250, weightKg: 350, sex: 'male', activity: 'very-active', calorieAdjustment: 500 }, 'preview');
    assert.equal(highest.calories, 9960, 'the largest allowed inputs still fit the upper calorie bound');
    for (const values of [
      { age: 18, heightCm: 100, weightKg: 30, sex: 'male', calorieAdjustment: 500 },
      { age: 100, heightCm: 250, weightKg: 350, activity: 'sedentary', calorieAdjustment: -500 },
      { proteinPerKg: 0.8, fatPercent: 15, effectiveDate: '2028-02-29' },
      { proteinPerKg: 3, fatPercent: 40, calorieAdjustment: 500 }
    ]) assert.doesNotThrow(() => calculateNutritionTargets({ ...base, ...values }, 'preview'));
  });
} finally {
  await rm(output, { recursive: true, force: true });
}

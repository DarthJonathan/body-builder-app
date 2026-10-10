import type { Goal, NutritionTargets, TargetCalculation } from './domain';

export const CALCULATION_VERSION = 'mifflin-st-jeor-v1' as const;
export const ACTIVITY_FACTORS: Record<TargetCalculation['activity'], number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, 'very-active': 1.9
};
export const GOAL_ADJUSTMENTS: Record<Goal, number> = {
  'build-muscle': 250, maintain: 0, 'lose-fat': -300
};
export const DEFAULT_PROTEIN_PER_KG = 1.6;
export const DEFAULT_FAT_PERCENT = 25;

export function sameCalculationProvenance(left: NutritionTargets['calculation'], right: NutritionTargets['calculation']): boolean {
  if (!left || !right) return left === right;
  const fields: (keyof TargetCalculation)[] = ['age', 'sex', 'heightCm', 'weightKg', 'activity', 'goal', 'effectiveDate', 'calorieAdjustment', 'proteinPerKg', 'fatPercent'];
  return left.version === right.version && left.restingCalories === right.restingCalories && left.maintenanceCalories === right.maintenanceCalories && fields.every(key => left.input[key] === right.input[key]);
}

function bounded(value: unknown, label: string, min: number, max: number, integer = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
  }
}

export function validateTargetCalculation(value: unknown): asserts value is TargetCalculation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter your calculation inputs first.');
  const input = value as Record<string, unknown>;
  const fields = ['age', 'sex', 'heightCm', 'weightKg', 'activity', 'goal', 'effectiveDate', 'calorieAdjustment', 'proteinPerKg', 'fatPercent'];
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Calculation inputs contain an unsupported field.');
  bounded(input.age, 'Age', 18, 100, true);
  if (input.sex !== 'female' && input.sex !== 'male') throw new Error('Choose an equation sex.');
  bounded(input.heightCm, 'Height in cm', 100, 250);
  bounded(input.weightKg, 'Weight in kg', 30, 350);
  if (typeof input.activity !== 'string' || !Object.hasOwn(ACTIVITY_FACTORS, input.activity)) throw new Error('Choose an activity level.');
  if (typeof input.goal !== 'string' || !Object.hasOwn(GOAL_ADJUSTMENTS, input.goal)) throw new Error('Choose a goal.');
  if (typeof input.effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new Error('Effective date must be a calendar date.');
  const parsed = new Date(`${input.effectiveDate}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.effectiveDate) throw new Error('Effective date is not a valid calendar date.');
  bounded(input.calorieAdjustment, 'Calorie adjustment', -500, 500);
  bounded(input.proteinPerKg, 'Protein per kg', 0.8, 3);
  bounded(input.fatPercent, 'Fat percentage', 15, 40);
}

/** Deterministic app policy. The caller supplies identity; nothing is saved here. */
export function calculateNutritionTargets(input: TargetCalculation, targetId: string): NutritionTargets {
  validateTargetCalculation(input);
  const resting = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.sex === 'male' ? 5 : -161);
  const maintenance = resting * ACTIVITY_FACTORS[input.activity];
  const calories = Math.round((maintenance + input.calorieAdjustment) / 10) * 10;
  if (calories < 1000 || calories > 10000) throw new Error('This calculation is outside the supported 1,000–10,000 calorie range. Review your inputs and adjustment.');
  const protein = Math.round(input.weightKg * input.proteinPerKg);
  const fat = Math.round(calories * input.fatPercent / 100 / 9);
  const remaining = calories - protein * 4 - fat * 9;
  if (remaining < 0) throw new Error('Protein and fat use more than the calorie target. Reduce their settings or adjust the calorie target.');
  const carbs = Math.round(remaining / 4);
  return {
    id: targetId, effectiveDate: input.effectiveDate, calories, protein, carbs, fat,
    mode: 'calculated', manuallyOverridden: false,
    calculation: { version: CALCULATION_VERSION, input: { ...input }, restingCalories: Math.round(resting), maintenanceCalories: Math.round(maintenance) }
  };
}

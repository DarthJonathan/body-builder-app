export type Tab = 'lessons' | 'nutrition' | 'dashboard' | 'workout' | 'progress';
export type Effort = 'easy' | 'medium' | 'hard' | null;
export type Goal = 'build-muscle' | 'maintain' | 'lose-fat';
export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';
export type Nutrients = { calories: number; protein: number; carbs: number; fat: number };
export type Profile = {
  id: string; displayName: string; email: string; timezone: string;
  unit: 'kg' | 'lb'; goal: Goal; startWeight: number; goalStartedAt: string;
  role: 'admin' | 'user';
};
export type Muscle = { id: string; name: string; image: string; percentage?: number };
export type Exercise = {
  id: string; name: string; image: string; muscles: string[]; equipment: string;
  instructions: string[]; source?: string; sourceName?: string; sourceNote?: string; weighted: boolean;
};
export type Prescription = {
  id: string; exerciseId: string; sets: number; repsMin: number; repsMax: number;
  perSide?: boolean; seconds?: boolean; amrapLast?: boolean; restSeconds: number; superset?: string;
};
export type Workout = { id: string; name: string; muscles: Muscle[]; exercises: Prescription[]; warmup: string[] };
export type Program = { id: string; name: string; level: string; goal: Goal; workouts: Workout[]; source?: string };
export type ProgramTemplate = Program & { description: string; daysPerWeek: number; equipment: string; source: string };
export type ScheduleEntry = { id: string; date: string; workoutId: string | null };
export type LoggedSet = { id: string; weight: number; reps: number; effort: Effort; completed: boolean };
export type SessionExercise = { id: string; exerciseId: string; prescription: Prescription; notes: string; sets: LoggedSet[] };
export type WorkoutSession = {
  id: string; workoutId: string; name: string; date: string; startedAt: string;
  finishedAt: string | null; exercises: SessionExercise[];
  restDeadline: string | null; restDuration: number;
};
export type Food = Nutrients & { id: string; name: string; serving: string; source: string };
export type FoodEntry = Nutrients & {
  id: string; foodId?: string; name: string; date: string; meal: Meal;
  quantity: number; serving: string; source: 'database' | 'manual' | 'ai-estimate';
  databaseSource?: string;
};
export type NutritionTargets = Nutrients & {
  id: string; effectiveDate: string; mode: 'manual' | 'calculated'; manuallyOverridden: boolean;
  calculation?: {
    version: 'mifflin-st-jeor-v1'; input: TargetCalculation;
    restingCalories: number; maintenanceCalories: number;
  };
};
export type CheckIn = { id: string; date: string; weight: number; notes: string };
export type WeightEntry = { id: string; date: string; weight: number };
export type Lesson = {
  id: string; title: string; url: string; notes: string; category: string;
  source: string; completed: boolean; savedAt: string;
};
export type Reading = { id: string; title: string; url: string; description: string; category: string; source: string; minutes: number };
export type ProviderConfig = {
  provider: 'openai' | 'anthropic' | 'openrouter'; model: string; enabled: boolean;
  configured: boolean;
  dailyRequestLimit?: number;
};
/** Credentials are request-only. They are never included in a saved snapshot. */
export type ProviderSettings = ProviderConfig & { apiKey?: string };
export type MealEstimate = { items: (Nutrients & { name: string; quantity: number; serving: string })[]; assumptions: string; preview: boolean };
export type TargetCalculation = {
  age: number; sex: 'female' | 'male'; heightCm: number; weightKg: number;
  activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very-active';
  goal: Goal; effectiveDate: string;
  calorieAdjustment: number; proteinPerKg: number; fatPercent: number;
};
export type SyncState = {
  phase: 'signed-out' | 'synced' | 'syncing' | 'pending' | 'offline' | 'conflict' | 'error' | 'expired';
  pending: number; revision: number; message: string; operations: string[];
};
export type AppSnapshot = {
  revision?: number;
  profile: Profile; programs: Program[]; activeProgramId: string;
  schedule: ScheduleEntry[]; sessions: WorkoutSession[]; foodEntries: FoodEntry[];
  targets: NutritionTargets[]; checkIns: CheckIn[]; weights: WeightEntry[];
  lessons: Lesson[]; provider: ProviderConfig;
};

export interface TrainingClient {
  getSnapshot(): Promise<AppSnapshot>;
  /** Read the current user's acknowledged cache without a request or pending projections. */
  getAcknowledgedSnapshot?(): Promise<AppSnapshot | null>;
  /** The second argument is a password in live mode, a display name in explicit preview mode. */
  signIn(email: string, credential?: string): Promise<AppSnapshot>;
  signUp?(displayName: string, email: string, password: string): Promise<AppSnapshot>;
  signOut(): Promise<void>;
  resetPreview(): Promise<AppSnapshot>;
  updateProfile(patch: Partial<Profile>): Promise<AppSnapshot>;
  saveProgram(program: Program): Promise<AppSnapshot>;
  useTemplate(templateId: string): Promise<AppSnapshot>;
  assignWorkout(date: string, workoutId: string | null): Promise<AppSnapshot>;
  startWorkout(workoutId: string, date: string): Promise<AppSnapshot>;
  saveSession(session: WorkoutSession): Promise<AppSnapshot>;
  finishSession(sessionId: string, finishedAt?: string): Promise<AppSnapshot>;
  saveFood(entry: FoodEntry): Promise<AppSnapshot>;
  deleteFood(id: string): Promise<AppSnapshot>;
  copyFoods(fromDate: string, toDate: string): Promise<AppSnapshot>;
  searchFoods(query: string): Promise<Food[]>;
  saveTargets(targets: NutritionTargets): Promise<AppSnapshot>;
  saveCheckIn(checkIn: CheckIn): Promise<AppSnapshot>;
  saveWeight(entry: WeightEntry): Promise<AppSnapshot>;
  saveLesson(lesson: Lesson): Promise<AppSnapshot>;
  deleteLesson(id: string): Promise<AppSnapshot>;
  saveProvider(config: ProviderSettings): Promise<AppSnapshot>;
  testProvider?(): Promise<{ message: string }>;
  askQuestion(question: string): Promise<{ answer: string; preview: boolean }>;
  estimateMeal(image: File): Promise<MealEstimate>;
  /** onOffline runs only when a transport failure uses the identical local equation. */
  calculateTargets?(input: TargetCalculation, onOffline?: () => void): Promise<NutritionTargets>;
  refresh?(): Promise<AppSnapshot>;
  resolveConflict?(resolution: 'keep-local' | 'use-server'): Promise<AppSnapshot>;
  discardPending?(): Promise<AppSnapshot>;
  subscribe?(listener: (snapshot: AppSnapshot | null) => void): () => void;
  setEditing?(active: boolean): void;
}

export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
export function id(prefix = 'record'): string { return `${prefix}-${crypto.randomUUID()}`; }
export function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
export function shiftDate(date: string, amount: number): string {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + amount); return localDate(d);
}
export function weekDates(date: string): string[] {
  const day = new Date(`${date}T12:00:00`).getDay();
  const monday = shiftDate(date, -(day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}
export function sumNutrients(items: Nutrients[]): Nutrients {
  return items.reduce((a, b) => ({ calories: a.calories + b.calories, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}
export function targetsForDate(data: AppSnapshot, date: string): NutritionTargets {
  return [...data.targets].filter(t => t.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]
    ?? { id: 'empty', effectiveDate: date, calories: 0, protein: 0, carbs: 0, fat: 0, mode: 'manual', manuallyOverridden: false };
}

import rules from './goal-rules.json';
import { exercises, muscles } from './catalogue';
import { id, shiftDate } from './domain';
import type { AppSnapshot, CreateGoalPlan, GoalAnswers, GoalPreview, Program } from './domain';
import { calculateNutritionTargets, sameCalculationProvenance, validateTargetCalculation } from './nutrition';
import { targets as validateTargets } from './mock/validation';
import { EXPERT_GOAL_VERSION, selectionEqual } from './expert';

export const GOAL_VERSION = 'goal-planner-v1' as const;
export const GOAL_SOURCES = rules.sources;
export const SPLIT_LABELS = rules.splitLabels;
export function recommendedSplit(days: number): GoalAnswers['split'] { return days <= 3 ? 'full-body' : days === 4 ? 'upper-lower' : days === 5 ? 'hybrid' : 'ppl'; }
export function compatibleSplits(days: number): GoalAnswers['split'][] { return days <= 3 ? ['full-body'] : days === 4 ? ['upper-lower', 'full-body'] : days === 5 ? ['hybrid', 'upper-lower'] : ['ppl', 'upper-lower']; }
export function defaultDays(days: number): number[] { return [...rules.defaultDays[String(days) as keyof typeof rules.defaultDays]]; }
export function paceAdjustment(goal: GoalAnswers['goal'], pace: GoalAnswers['pace']): number { return goal === 'maintain' ? 0 : goal === 'build-muscle' ? (pace === 'gentle' ? 150 : 250) : (pace === 'gentle' ? -200 : -300); }

export function validateGoalAnswers(a: GoalAnswers): void {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Answer the goal questions first.');
  const keys = ['goal','startDate','experience','restrictions','equipment','daysPerWeek','sessionMinutes','focus','split','workoutDays','nutritionExperience','pace','nutrition','trainingPriority','programSelection'];
  if (Object.keys(a).some(k => !keys.includes(k))) throw new Error('Unsupported goal question.');
  if (a.trainingPriority !== undefined && !['hypertrophy','strength','general'].includes(a.trainingPriority)) throw new Error('Choose a training priority.');
  for (const [field, choices] of Object.entries({goal:['build-muscle','maintain','lose-fat'],experience:['beginner','intermediate','advanced'],restrictions:['none','keep-current'],equipment:['full-gym','dumbbells'],sessionMinutes:[30,45,60],focus:['balanced','glutes'],nutritionExperience:['new','familiar','confident'],pace:['gentle','moderate']})) {
    if (!(choices as unknown[]).includes(a[field as keyof GoalAnswers])) throw new Error(`Choose ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}.`);
  }
  if (!Number.isInteger(a.daysPerWeek) || a.daysPerWeek < 2 || a.daysPerWeek > 6 || !compatibleSplits(a.daysPerWeek).includes(a.split)) throw new Error('Choose a split compatible with two to six training days.');
  if (!Array.isArray(a.workoutDays) || a.workoutDays.length !== a.daysPerWeek || new Set(a.workoutDays).size !== a.daysPerWeek || a.workoutDays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Assign each workout to a different weekday.');
  validateTargetCalculation(a.nutrition);
  if (a.nutrition.goal !== a.goal || a.nutrition.effectiveDate !== a.startDate || a.nutrition.calorieAdjustment !== paceAdjustment(a.goal, a.pace)) throw new Error('Nutrition inputs must match the goal, start date and chosen pace.');
}

/** Starting doses and split selection are disclosed app policy, not a clinical prescription. */
export function previewGoal(a: GoalAnswers, current?: Program): GoalPreview {
  validateGoalAnswers(a);
  const rationale = [
    `${a.daysPerWeek} weekly sessions fit your availability. Split choice follows your schedule; no split is universally best.`,
    `${a.experience === 'beginner' ? 'Two' : 'Three'} working sets per exercise are a starting dose. Build gradually; adjust volume and load using your logged performance and recovery.`,
    `Plan around ${a.sessionMinutes} minutes, allowing extra time for warm-up and rest. This is a time budget, not a guarantee.`,
    'Keep repetitions controlled. Training to failure is optional. Review load increases when you complete the prescribed range with good technique.',
    a.nutrition.healthEnergy ? 'Maintenance uses the average of complete Apple Health resting + active energy days, without an activity multiplier. This is device-estimated expenditure, not a laboratory BMR measurement.' : 'Resting energy uses Mifflin–St Jeor; maintenance adds an activity factor. Both are initial estimates.',
    `${paceAdjustment(a.goal, a.pace)} kcal/day is the starting goal adjustment. Protein starts at ${a.nutrition.proteinPerKg} g/kg. Targets remain editable; assess weight trends over several weeks.`
  ];
  let program: Program;
  if (a.restrictions === 'keep-current') {
    if (!current?.workouts.length) throw new Error('An existing individually suitable program is needed to keep your current workouts.');
    program = structuredClone(current);
    rationale[1] = 'Your current workout prescriptions are retained. These answers do not establish whether exercises are suitable for a medical condition or injury.';
  } else {
    const groups = rules.routines[a.equipment];
    const routine = a.split === 'hybrid' ? [...groups['upper-lower'], groups['full-body'][0]] : groups[a.split];
    const count = a.sessionMinutes === 30 ? 4 : a.sessionMinutes === 45 ? 5 : 6;
    program = {
      id: 'goal-preview', name: `${a.daysPerWeek}-Day ${SPLIT_LABELS[a.split]}`, level: a.experience[0].toUpperCase() + a.experience.slice(1), goal: a.goal,
      source: rules.sources[0].url, sourceName: 'BodyBuilder evidence-informed starting plan', sourceReviewedAt: rules.reviewedAt,
      adaptationNote: 'Exercise selection, split and starting doses are BodyBuilder app policy informed by the linked research. Edit to suit your preferences and progress.',
      workouts: Array.from({length:a.daysPerWeek}, (_, i) => {
        const item = routine[i % routine.length]; let selected = [...item.exercises];
        if (a.focus === 'glutes' && (item.name.startsWith('Lower') || item.name.startsWith('Full') || item.name === 'Legs')) {
          const glute = a.equipment === 'full-gym' ? 'hip-thrust' : 'glute-bridge';
          selected = [glute, ...selected.filter(e => e !== glute)];
        }
        selected = selected.slice(0, count);
        const working = selected.map((exerciseId, j) => {
          const exercise = exercises.find(e => e.id === exerciseId); if (!exercise) throw new Error(`Exercise ${exerciseId} is unavailable.`);
          const seconds = exerciseId === 'plank';
          return { id: `goal-prescription-${i}-${j}`, exerciseId, sets: a.experience === 'beginner' ? 2 : 3, repsMin: seconds ? 20 : 8, repsMax: seconds ? 40 : 12, restSeconds: j < 4 ? 120 : 90,
            ...(seconds ? {seconds:true} : {}), ...(['reverse-lunge','dumbbell-lunge','one-arm-dumbbell-row'].includes(exerciseId) ? {perSide:true} : {}) };
        });
        const muscleIds = [...new Set(selected.flatMap(e => exercises.find(x=>x.id===e)!.muscles))];
        return { id:`goal-workout-${i}`, name:`${item.name}${i >= routine.length ? ' · 2' : ''}`, muscles: muscles.filter(m=>muscleIds.includes(m.id)), exercises: working,
          warmup:['Start with 5 minutes of easy movement.', 'Use lighter practice sets before your first demanding lifts.'] };
      })
    };
  }
  return {version:GOAL_VERSION,program,targets:calculateNutritionTargets(a.nutrition, 'goal-target-preview'),rationale};
}

export function validateGoalCreation(input: CreateGoalPlan, current?: Program, expertPreview?: GoalPreview): GoalPreview {
  if (!input || ![GOAL_VERSION,EXPERT_GOAL_VERSION].includes(input.version) || !['keep-existing','replace-upcoming'].includes(input.schedulePolicy) || Object.keys(input).some(k=>!['version','answers','targets','schedulePolicy'].includes(k))) throw new Error('Unsupported goal plan or schedule choice.');
  validateGoalAnswers(input.answers);
  if(input.version===GOAL_VERSION && (input.answers.trainingPriority || input.answers.programSelection)) throw new Error('Use the library goal version for program recommendations.');
  if(input.version===EXPERT_GOAL_VERSION && (!expertPreview || expertPreview.version!==EXPERT_GOAL_VERSION || !selectionEqual(input.answers.programSelection,expertPreview.selection))) throw new Error('Review the current library recommendation before creating your plan.');
  const preview = input.version===EXPERT_GOAL_VERSION ? expertPreview! : previewGoal(input.answers, current);
  validateTargets(input.targets, true);
  if (input.targets.effectiveDate !== input.answers.startDate || !sameCalculationProvenance(input.targets.calculation, preview.targets.calculation)) throw new Error('Preview the current answers before creating your plan.');
  return preview;
}

export function applyGoalCreation(data: AppSnapshot, input: CreateGoalPlan, today: string, expertPreview?: GoalPreview): void {
  const current = data.programs.find(p=>p.id===data.activeProgramId);
  const preview = validateGoalCreation(input, current, expertPreview);
  if (input.answers.startDate < today || input.answers.startDate > shiftDate(today, 28)) throw new Error('Start your new goal today or within the next 28 days.');
  if ((data.goalPlans?.length ?? 0) >= 100) throw new Error('This account already has 100 goal plans.');
  let program = preview.program;
  if (input.answers.restrictions === 'none') {
    program = { ...program, id:id('program'), workouts:program.workouts.map(w=>({...w,id:id('workout'),exercises:w.exercises.map(p=>({...p,id:id('prescription')}))})) };
    if(program.details) program.details={...structuredClone(program.details),key:`copy-${program.id}`};
    data.programs.push(program); data.activeProgramId = program.id;
  }
  const targets = {...structuredClone(input.targets), id:id('targets')};
  data.targets = data.targets.filter(t=>t.effectiveDate!==targets.effectiveDate); data.targets.push(targets);
  data.profile.goal = input.answers.goal; data.profile.startWeight = input.answers.nutrition.weightKg; data.profile.goalStartedAt = input.answers.startDate;
  for (let i=0;i<28;i++) {
    const date = shiftDate(input.answers.startDate,i), day=(new Date(`${date}T12:00:00`).getDay()+6)%7;
    if (data.sessions.some(s=>s.date===date)) continue;
    const existing = data.schedule.find(s=>s.date===date);
    if (existing?.workoutId && input.schedulePolicy==='keep-existing') continue;
    const workout = input.answers.workoutDays.indexOf(day);
    const entry = {id:existing?.id ?? id('schedule'),date,workoutId:workout<0 ? null : program.workouts[workout % program.workouts.length].id};
    if (existing) Object.assign(existing,entry); else data.schedule.push(entry);
  }
  data.goalPlans ??= [];
  data.goalPlans.push({...structuredClone(input), targets, id:id('goal'),createdAt:new Date().toISOString(),programId:program.id,rationale:preview.rationale});
  if (input.answers.nutrition.healthEnergy) data.healthEnergy=structuredClone(input.answers.nutrition.healthEnergy);
}

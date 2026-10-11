import sourceGuides from './exercise-guides.json';
import programDocuments from './program-library.json';
import { templateFromDocument } from './program-documents';
import type { ProgramDocument } from './domain';
import type { Exercise, Muscle, ProgramTemplate, Reading, Food, Workout, Prescription } from './domain';

export const muscles: Muscle[] = [
  ['glutes', 'Glutes'], ['core', 'Core'], ['quadriceps', 'Quadriceps'], ['hamstrings', 'Hamstrings'],
  ['calves', 'Calves'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['biceps', 'Biceps'], ['chest', 'Chest'], ['triceps', 'Triceps']
].map(([id, name]) => ({ id, name, image: `/images/muscles/${id}.svg` }));

type ExerciseSpec = [id: string, name: string, muscles: string[], equipment: string, weighted?: boolean];
type SourceGuide = { sourceURL: string; sourceName: string; instructions: string[]; note: string };
const guides = sourceGuides as Record<string, SourceGuide>;
const specs: ExerciseSpec[] = [
  ['deadlift', 'Barbell Deadlift', ['glutes', 'hamstrings', 'back'], 'Barbell'],
  ['hip-thrust', 'Barbell Hip Thrust', ['glutes'], 'Barbell'],
  ['reverse-lunge', 'Front Foot Elevated Reverse Lunges', ['glutes', 'quadriceps'], 'Dumbbells'],
  ['kickback', 'Cable Kickbacks', ['glutes'], 'Cable machine'],
  ['band-abduction', 'Banded Hip Abductions', ['glutes'], 'Resistance band', false],
  ['machine-sit-up', 'Machine Sit Ups', ['core'], 'Machine'],
  ['plank', 'RKC Plank', ['core'], 'Bodyweight', false],
  ['pushup', 'Push-Ups (bands optional)', ['chest', 'triceps', 'shoulders'], 'Bodyweight', false],
  ['lat-pulldown', 'Lat Pulldowns', ['back', 'biceps'], 'Cable machine'],
  ['shoulder-press', 'Seated Dumbbell Shoulder Press', ['shoulders', 'triceps'], 'Dumbbells'],
  ['supported-row', 'Dumbbell Chest Supported Row (mid/upper back focused)', ['back', 'biceps'], 'Dumbbells'],
  ['lateral-raise', 'Cable Lateral Raise', ['shoulders'], 'Cable machine'],
  ['preacher-curl', 'Dumbbell Preacher Curl', ['biceps'], 'Dumbbells'],
  ['squat', 'Barbell Back Squat', ['glutes', 'quadriceps'], 'Barbell'],
  ['calf-raise', 'Leg Press Calf Raises', ['calves'], 'Leg press'],
  ['machine-abduction', 'Hip Abduction Machine', ['glutes'], 'Machine'],
  ['walking-lunge', 'Walking Lunges (Quad Focused)', ['quadriceps', 'glutes'], 'Dumbbells'],
  ['dead-bug', 'Dead Bug', ['core'], 'Bodyweight', false],
  ['flat-dumbbell-press', 'Flat Dumbbell Press', ['chest', 'triceps'], 'Dumbbells'],
  ['cable-row', 'Lat Focused Cable Row', ['back', 'biceps'], 'Cable machine'],
  ['rear-delt-fly', 'Rear Delt Cable Fly', ['shoulders', 'back'], 'Cable machine'],
  ['tricep-extension', 'Incline Dumbbell Overhead Extensions', ['triceps'], 'Dumbbells'],
  ['romanian-deadlift', 'Barbell Romanian Deadlift', ['hamstrings', 'glutes'], 'Barbell'],
  ['hip-thrust-machine', 'Hip Thrust Machine', ['glutes'], 'Machine'],
  ['split-squat', 'Bulgarian Split Squat (Glute Focused)', ['glutes', 'quadriceps'], 'Dumbbells'],
  ['leg-curl', 'Seated Leg Curls', ['hamstrings'], 'Machine'],
  ['leg-extension', 'Seated Leg Extensions', ['quadriceps'], 'Machine'],
  ['bench-press', 'Barbell Bench Press', ['chest', 'triceps'], 'Barbell'],
  ['barbell-row', 'Barbell Row', ['back', 'biceps'], 'Barbell'],
  ['overhead-press', 'Standing Overhead Press', ['shoulders', 'triceps'], 'Barbell'],
  ['chinup', 'Chin-Ups', ['back', 'biceps'], 'Pull-up bar', false],
  ['pec-deck', 'Pec Deck', ['chest'], 'Machine'],
  ['triceps-pushdown', 'Cable Triceps Pushdown', ['triceps'], 'Cable machine'],
  ['cable-curl', 'Cable Curls', ['biceps'], 'Cable machine'],
  ['incline-press', 'Incline Dumbbell Bench Press', ['chest', 'triceps'], 'Dumbbells'],
  ['rack-pull', 'Rack Deadlifts', ['back', 'glutes'], 'Barbell'],
  ['military-press', 'Military Press', ['shoulders', 'triceps'], 'Barbell'],
  ['machine-chest-press', 'Machine Chest Press', ['chest', 'triceps'], 'Machine'],
  ['machine-shoulder-press', 'Machine Shoulder Press', ['shoulders', 'triceps'], 'Machine'],
  ['dumbbell-curl', 'Dumbbell Curls', ['biceps'], 'Dumbbells'],
  ['triceps-dip', 'Machine Triceps Dip', ['triceps', 'chest'], 'Machine'],
  ['cable-crunch', 'Cable Crunches', ['core'], 'Cable machine'],
  ['cable-pull-through', 'Cable Pull Through', ['glutes', 'hamstrings'], 'Cable machine'],
  ['standing-calf-raise', 'Standing Calf Raise', ['calves'], 'Machine'],
  ['seated-calf-raise', 'Seated Calf Raise', ['calves'], 'Machine'],
  ['dumbbell-rdl', 'Dumbbell Stiff Leg Deadlift', ['hamstrings', 'glutes'], 'Dumbbells'],
  ['leg-press', 'Leg Press', ['quadriceps', 'glutes'], 'Machine'],
  ['hack-squat', 'Hack Squat', ['quadriceps'], 'Machine'],
  ['hyperextension', 'Back Extensions', ['back', 'glutes'], 'Bodyweight', false],
  ['weighted-sit-up', 'Decline Weighted Sit Ups', ['core'], 'Dumbbells'],
  ['reverse-crunch', 'Reverse Crunches', ['core'], 'Bodyweight', false],
  ['hanging-leg-raise', 'Hanging Leg Raises', ['core'], 'Pull-up bar', false],
  ['dumbbell-squat', 'Dumbbell Squat', ['quadriceps', 'glutes'], 'Dumbbells'],
  ['dumbbell-row', 'Bent Over Dumbbell Row', ['back', 'biceps'], 'Dumbbells'],
  ['dumbbell-lateral-raise', 'Dumbbell Lateral Raise', ['shoulders'], 'Dumbbells'],
  ['dumbbell-lunge', 'Dumbbell Lunge', ['quadriceps', 'glutes'], 'Dumbbells'],
  ['standing-dumbbell-press', 'Standing Dumbbell Shoulder Press', ['shoulders', 'triceps'], 'Dumbbells'],
  ['dumbbell-fly', 'Dumbbell Fly', ['chest'], 'Dumbbells'],
  ['hammer-curl', 'Dumbbell Hammer Curl', ['biceps'], 'Dumbbells'],
  ['seated-dumbbell-extension', 'Seated Dumbbell Triceps Extension', ['triceps'], 'Dumbbells'],
  ['dumbbell-step-up', 'Dumbbell Step Up', ['quadriceps', 'glutes'], 'Dumbbells and sturdy step'],
  ['one-arm-dumbbell-row', 'One Arm Dumbbell Row', ['back', 'biceps'], 'Dumbbells'],
  ['dumbbell-rear-delt-fly', 'Dumbbell Rear Delt Fly', ['shoulders', 'back'], 'Dumbbells'],
  ['close-grip-dumbbell-press', 'Close Grip Dumbbell Press', ['chest', 'triceps'], 'Dumbbells'],
  ['good-morning', 'Barbell Good Morning', ['hamstrings', 'glutes', 'back'], 'Barbell'],
  ['bodyweight-kickback', 'Bodyweight Glute Kickback', ['glutes'], 'Bodyweight', false],
  ['goblet-squat', 'Goblet Squat', ['quadriceps', 'glutes'], 'Dumbbell or kettlebell'],
  ['crunch', 'Crunches', ['core'], 'Bodyweight', false],
  ['glute-bridge', 'Bodyweight Glute Bridge', ['glutes', 'hamstrings'], 'Bodyweight', false],
  ['lying-leg-raise', 'Lying Leg Raise', ['core'], 'Bodyweight and bench', false],
  ['face-pull', 'Cable Face Pull', ['shoulders', 'back'], 'Cable machine'],
  ['barbell-curl', 'Barbell Curl', ['biceps'], 'Barbell'],
  ['skullcrusher', 'Barbell Skullcrusher', ['triceps'], 'Barbell and bench'],
  ['incline-barbell-press', 'Incline Barbell Bench Press', ['chest', 'triceps'], 'Barbell and incline bench'],
  ['incline-dumbbell-curl', 'Incline Dumbbell Curl', ['biceps'], 'Dumbbells and incline bench'],
  ['front-squat', 'Barbell Front Squat', ['quadriceps', 'glutes'], 'Barbell'],
  ['barbell-lunge', 'Barbell Lunge', ['quadriceps', 'glutes'], 'Barbell']
];
export const exercises: Exercise[] = specs.map(([id, name, muscleIds, equipment, weighted = true]) => ({
  id, name, muscles: muscleIds, equipment, weighted, image: ['band-abduction', 'hip-thrust-machine'].includes(id) ? '/images/exercise-placeholder.svg' : `/images/exercises/${id}.jpg`,
  source: guides[id]?.sourceURL ?? 'https://github.com/yuhonas/free-exercise-db',
  sourceName: guides[id]?.sourceName,
  sourceNote: guides[id]?.note,
  instructions: guides[id]?.instructions ?? ['Use the workout prescription as a logging guide.', 'Follow your chosen technique reference for this variation.']
}));

function rx(exerciseId: string, sets = 3, repsMin = 8, repsMax = 12, options: Partial<Prescription> = {}): Prescription {
  return { id: `prescription-${exerciseId}`, exerciseId, sets, repsMin, repsMax, restSeconds: 90, ...options };
}
function targets(...entries: [string, number][]): Muscle[] {
  return entries.map(([id, percentage]) => ({ ...muscles.find(m => m.id === id)!, percentage }));
}
const warmup = ['5 minutes of easy movement', 'Practice the first movement with a light load', 'Gradually build up to your working weight'];
export const previewWorkouts: Workout[] = [
  { id: 'lower-1', name: 'Lower 1', muscles: targets(['glutes', 50], ['quadriceps', 25], ['calves', 13], ['core', 12]), warmup, exercises: [rx('squat', 3, 6, 10), rx('hip-thrust', 3, 10, 15), rx('walking-lunge', 3, 8, 12, { perSide: true }), rx('machine-abduction', 3, 10, 15), rx('calf-raise', 3, 10, 15, { superset: 'a' }), rx('dead-bug', 3, 5, 10, { superset: 'a' })] },
  { id: 'upper-2', name: 'Upper 2', muscles: targets(['back', 34], ['shoulders', 33], ['chest', 17], ['triceps', 16]), warmup, exercises: [rx('flat-dumbbell-press'), rx('lat-pulldown'), rx('shoulder-press'), rx('cable-row', 3, 10, 15), rx('rear-delt-fly', 3, 10, 15, { superset: 'a' }), rx('tricep-extension', 3, 10, 15, { superset: 'a' })] },
  { id: 'lower-2', name: 'Lower 2', muscles: targets(['glutes', 75], ['core', 13], ['quadriceps', 12]), warmup, exercises: [rx('deadlift', 3, 6, 10, { superset: 'a' }), rx('hip-thrust', 3, 10, 15, { superset: 'a' }), rx('reverse-lunge', 2, 8, 12, { perSide: true }), rx('kickback', 2, 10, 20, { perSide: true, superset: 'b' }), rx('band-abduction', 2, 10, 20, { superset: 'b' }), rx('machine-sit-up', 2, 10, 20, { superset: 'c' }), rx('plank', 2, 30, 60, { seconds: true, superset: 'c' })] },
  { id: 'upper-1', name: 'Upper 1', muscles: targets(['back', 33], ['shoulders', 33], ['biceps', 17], ['chest', 17]), warmup, exercises: [rx('pushup', 3, 10, 20), rx('lat-pulldown'), rx('shoulder-press'), rx('supported-row'), rx('lateral-raise', 3, 10, 20, { perSide: true, superset: 'a' }), rx('preacher-curl', 3, 8, 12, { perSide: true, superset: 'a' })] }
];

const templateWorkout = (id: string, name: string, exercises: Prescription[]): Workout => ({
  id, name, exercises, warmup, muscles: [...new Set(exercises.flatMap(p => specs.find(s => s[0] === p.exerciseId)?.[2] ?? []))].map(id => ({ ...muscles.find(m => m.id === id)! }))
});
const sourceReviewedAt = '2026-10-10';
function pplPull(id: string, name: string, heavy: 'deadlift' | 'barbell-row'): Workout {
  return templateWorkout(id, name, [
    rx(heavy, heavy === 'deadlift' ? 1 : 5, 5, 5, { amrapLast: true, restSeconds: 180 }),
    rx('lat-pulldown'), rx('supported-row'), rx('face-pull', 5, 15, 20), rx('hammer-curl', 4), rx('dumbbell-curl', 4)
  ]);
}
function pplPush(id: string, name: string, heavy: 'bench-press' | 'overhead-press'): Workout {
  return templateWorkout(id, name, [
    rx(heavy, 5, 5, 5, { amrapLast: true, restSeconds: 180 }),
    rx(heavy === 'bench-press' ? 'overhead-press' : 'bench-press'), rx('incline-press'),
    rx('triceps-pushdown', 3, 8, 12, { superset: 'a' }),
    rx('dumbbell-lateral-raise', 3, 15, 20, { id: `${id}-lateral-a`, superset: 'a' }),
    rx('seated-dumbbell-extension', 3, 8, 12, { superset: 'b' }),
    rx('dumbbell-lateral-raise', 3, 15, 20, { id: `${id}-lateral-b`, superset: 'b' })
  ]);
}
function pplLegs(id: string, name: string): Workout {
  return templateWorkout(id, name, [
    rx('squat', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('romanian-deadlift'),
    rx('leg-press'), rx('leg-curl'), rx('standing-calf-raise', 5)
  ]);
}
export const templates: ProgramTemplate[] = [
  {
    id: 'upper-lower-4', name: '4-Day Upper / Lower', level: 'Beginner', goal: 'build-muscle', daysPerWeek: 4,
    equipment: 'Barbell, dumbbells, cables & machines', description: 'A balanced gym split with two upper and two lower sessions. Preview the original routine and make it yours.',
    source: 'https://www.muscleandstrength.com/workouts/upper-lower-4-day-gym-bodybuilding-workout',
    sourceName: 'Steve Shaw · Muscle & Strength', sourceReviewedAt,
    workouts: [
      templateWorkout('ul-upper-a', 'Upper A', [rx('bench-press', 3, 6, 12), rx('barbell-row', 3, 6, 12), rx('shoulder-press'), rx('pec-deck', 2, 10, 12), rx('lat-pulldown', 2, 10, 12), rx('lateral-raise', 2, 10, 15), rx('triceps-pushdown'), rx('cable-curl')]),
      templateWorkout('ul-lower-a', 'Lower A', [rx('squat', 3, 6, 12), rx('romanian-deadlift'), rx('standing-calf-raise', 3, 10, 15), rx('leg-extension', 2, 10, 12), rx('leg-curl', 2, 10, 12), rx('seated-calf-raise', 2, 10, 12), rx('cable-crunch', 3, 10, 12), rx('cable-pull-through', 3, 10, 12)]),
      templateWorkout('ul-upper-b', 'Upper B', [rx('incline-press'), rx('rack-pull', 3, 5, 8), rx('military-press'), rx('machine-chest-press', 2, 8, 12), rx('cable-row', 2, 8, 12), rx('machine-shoulder-press', 2, 8, 12), rx('dumbbell-curl'), rx('triceps-dip')]),
      templateWorkout('ul-lower-b', 'Lower B', [rx('leg-press', 3, 10, 20), rx('dumbbell-rdl'), rx('calf-raise', 3, 10, 15), rx('hack-squat', 2, 8, 12), rx('leg-curl', 2, 10, 12), rx('seated-calf-raise', 2, 10, 12), rx('cable-crunch', 3, 10, 12), rx('hyperextension', 3, 10, 12)])
    ]
  },
  {
    id: 'beginner-3', name: '3-Day Beginner Full Body', level: 'Beginner', goal: 'build-muscle', daysPerWeek: 3,
    equipment: 'Barbell & pull-up bar', description: 'Alternate two simple full-body sessions with rest days between them. The final set uses an AMRAP prescription.',
    source: 'https://thefitness.wiki/routines/r-fitness-basic-beginner-routine/',
    sourceName: 'The Fitness Wiki', sourceReviewedAt,
    workouts: [templateWorkout('beginner-a', 'Full Body A', [rx('barbell-row', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('bench-press', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('squat', 3, 5, 5, { amrapLast: true, restSeconds: 180 })]), templateWorkout('beginner-b', 'Full Body B', [rx('chinup', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('overhead-press', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('deadlift', 3, 5, 5, { amrapLast: true, restSeconds: 180 })])]
  },
  {
    id: 'phul-4', name: '4-Day PHUL Strength & Size', level: 'Intermediate', goal: 'build-muscle', daysPerWeek: 4,
    equipment: 'Barbell, dumbbells, cables & machines',
    description: 'Upper and lower power sessions followed by two muscle-building sessions. Train four days per week with rest between the pairs.',
    source: 'https://www.muscleandstrength.com/workouts/phul-workout',
    sourceName: 'Brandon Campbell · Muscle & Strength', sourceReviewedAt,
    adaptationNote: 'Uses the lower end of the source set ranges and seated leg curls. Rest defaults are 3 minutes for power compounds, 2 minutes for power accessories, and 90 seconds for hypertrophy (2 minutes for front squats). Adjust these in your copy.',
    workouts: [
      templateWorkout('phul-upper-power', 'Upper Power', [rx('bench-press', 3, 3, 5, { restSeconds: 180 }), rx('incline-press', 3, 6, 10, { restSeconds: 120 }), rx('barbell-row', 3, 3, 5, { restSeconds: 180 }), rx('lat-pulldown', 3, 6, 10, { restSeconds: 120 }), rx('overhead-press', 2, 5, 8, { restSeconds: 180 }), rx('barbell-curl', 2, 6, 10, { restSeconds: 120 }), rx('skullcrusher', 2, 6, 10, { restSeconds: 120 })]),
      templateWorkout('phul-lower-power', 'Lower Power', [rx('squat', 3, 3, 5, { restSeconds: 180 }), rx('deadlift', 3, 3, 5, { restSeconds: 180 }), rx('leg-press', 3, 10, 15, { restSeconds: 120 }), rx('leg-curl', 3, 6, 10, { restSeconds: 120 }), rx('standing-calf-raise', 4, 6, 10, { restSeconds: 120 })]),
      templateWorkout('phul-upper-hypertrophy', 'Upper Hypertrophy', [rx('incline-barbell-press'), rx('dumbbell-fly'), rx('cable-row'), rx('one-arm-dumbbell-row', 3, 8, 12, { perSide: true }), rx('dumbbell-lateral-raise'), rx('incline-dumbbell-curl'), rx('triceps-pushdown')]),
      templateWorkout('phul-lower-hypertrophy', 'Lower Hypertrophy', [rx('front-squat', 3, 8, 12, { restSeconds: 120 }), rx('barbell-lunge', 3, 8, 12, { perSide: true }), rx('leg-extension', 3, 10, 15), rx('leg-curl', 3, 10, 15), rx('seated-calf-raise'), rx('calf-raise')])
    ]
  },
  {
    id: 'ppl-6', name: '6-Day Push / Pull / Legs', level: 'Beginner / Intermediate', goal: 'build-muscle', daysPerWeek: 6,
    equipment: 'Barbell, dumbbells, cables & machines',
    description: 'Two pull, push, and leg rotations with one rest day each week. The heavy lifts alternate, with a final AMRAP set.',
    source: 'https://thefitness.wiki/reddit-archive/a-linear-progression-based-ppl-program-for-beginners/',
    sourceName: 'The Fitness Wiki · archived PPL routine', sourceReviewedAt,
    adaptationNote: 'Uses pulldowns, chest-supported rows, seated dumbbell extensions and standing calf raises from the source options. See the original for load progression and deloads; this app logs the weights you choose.',
    workouts: [pplPull('ppl-pull-a', 'Pull A', 'deadlift'), pplPush('ppl-push-a', 'Push A', 'bench-press'), pplLegs('ppl-legs-a', 'Legs A'), pplPull('ppl-pull-b', 'Pull B', 'barbell-row'), pplPush('ppl-push-b', 'Push B', 'overhead-press'), pplLegs('ppl-legs-b', 'Legs B')]
  },
  {
    id: 'barbell-5x5-3', name: '3-Day Barbell 5×5', level: 'Beginner', goal: 'build-muscle', daysPerWeek: 3,
    equipment: 'Barbell, plates, squat rack & bench',
    description: 'Alternate A and B on three non-consecutive days. Five sets of five for the main lifts; the deadlift has one working set.',
    source: 'https://stronglifts.com/stronglifts-5x5/workout-program/',
    sourceName: 'StrongLifts', sourceReviewedAt,
    adaptationNote: 'Core A/B sessions only; optional assistance is excluded. Review the source for starting loads, warm-up sets and progression. Working weights and calendar dates stay under your control.',
    workouts: [
      templateWorkout('barbell-5x5-a', 'Barbell 5×5 A', [rx('squat', 5, 5, 5, { restSeconds: 180 }), rx('bench-press', 5, 5, 5, { restSeconds: 180 }), rx('barbell-row', 5, 5, 5, { restSeconds: 180 })]),
      templateWorkout('barbell-5x5-b', 'Barbell 5×5 B', [rx('squat', 5, 5, 5, { restSeconds: 180 }), rx('overhead-press', 5, 5, 5, { restSeconds: 180 }), rx('deadlift', 1, 5, 5, { restSeconds: 180 })])
    ]
  },
  {
    id: 'dumbbell-full-body-3', name: '3-Day Dumbbell Full Body', level: 'Beginner', goal: 'build-muscle', daysPerWeek: 3,
    equipment: 'Dumbbells, adjustable bench & sturdy step',
    description: 'Three full-body sessions for home or the gym. Leave a rest day between sessions and choose your working weights.',
    source: 'https://www.muscleandstrength.com/workouts/3-day-full-body-dumbbell-workout',
    sourceName: 'Josh England · Muscle & Strength', sourceReviewedAt,
    adaptationNote: 'Shortened to six exercises per session. Day B uses one stiff-leg deadlift instead of the hamstring curl and deadlift; Day C uses a standard bench press. The lying triceps extension and Zottman curl are omitted.',
    workouts: [
      templateWorkout('db-full-a', 'Dumbbell Full Body A', [rx('dumbbell-squat', 3, 10, 10), rx('dumbbell-rdl', 3, 10, 10), rx('dumbbell-row', 3, 10, 10), rx('flat-dumbbell-press', 3, 10, 10), rx('dumbbell-lateral-raise', 2, 8, 8), rx('dumbbell-curl', 2, 8, 8)]),
      templateWorkout('db-full-b', 'Dumbbell Full Body B', [rx('dumbbell-lunge', 3, 10, 10, { perSide: true }), rx('dumbbell-rdl', 3, 10, 10), rx('standing-dumbbell-press', 3, 10, 10), rx('dumbbell-fly', 2, 8, 8), rx('hammer-curl', 2, 8, 8), rx('seated-dumbbell-extension', 2, 8, 8)]),
      templateWorkout('db-full-c', 'Dumbbell Full Body C', [rx('dumbbell-step-up', 3, 10, 10, { perSide: true }), rx('dumbbell-rdl', 3, 10, 10), rx('one-arm-dumbbell-row', 3, 10, 10, { perSide: true }), rx('flat-dumbbell-press', 3, 10, 10), rx('dumbbell-rear-delt-fly', 2, 8, 8), rx('close-grip-dumbbell-press', 2, 8, 8)])
    ]
  },
  {
    id: 'glute-focus-3', name: '3-Day Glute Focus', level: 'Beginner', goal: 'build-muscle', daysPerWeek: 3,
    equipment: 'Barbell, dumbbells & bench',
    description: 'Glutes first, with upper-body and core work across three sessions. Keep a rest day between these full-body workouts.',
    source: 'https://www.muscleandstrength.com/workouts/womens-3-day-glute-workout',
    sourceName: 'Roger Lockridge · Muscle & Strength', sourceReviewedAt,
    adaptationNote: 'Six movements per session; optional accessory days are excluded. RDLs replace stiff-leg deadlifts, split squats replace curtsy lunges, and regular dumbbell squats replace jump squats. See the source for the complete routine.',
    workouts: [
      templateWorkout('glute-full-a', 'Glute Focus A', [rx('hip-thrust', 3, 8, 12), rx('hyperextension', 3, 8, 12), rx('dumbbell-squat', 3, 12, 12, { restSeconds: 60 }), rx('lying-leg-raise', 3, 12, 12, { restSeconds: 60 }), rx('barbell-row', 3, 12, 12, { restSeconds: 60 }), rx('pushup', 3, 12, 12, { restSeconds: 60 })]),
      templateWorkout('glute-full-b', 'Glute Focus B', [rx('good-morning', 3, 8, 12), rx('bodyweight-kickback', 3, 8, 12, { perSide: true }), rx('romanian-deadlift', 3, 8, 12), rx('goblet-squat', 3, 12, 12, { restSeconds: 60 }), rx('crunch', 3, 12, 12, { restSeconds: 60 }), rx('incline-press', 3, 12, 12, { restSeconds: 60 })]),
      templateWorkout('glute-full-c', 'Glute Focus C', [rx('glute-bridge', 3, 15, 30, { seconds: true }), rx('split-squat', 3, 12, 12, { perSide: true }), rx('dumbbell-squat', 3, 12, 12, { restSeconds: 60 }), rx('walking-lunge', 3, 12, 12, { perSide: true, restSeconds: 60 }), rx('shoulder-press', 3, 12, 12, { restSeconds: 60 }), rx('dumbbell-row', 3, 12, 12, { restSeconds: 60 })])
    ]
  }
];

templates.unshift(...(programDocuments as ProgramDocument[]).map(doc=>templateFromDocument(doc,exercises,muscles)));

export const readings: Reading[] = [
  { id: 'strength-basics', title: 'Build your strength foundation', url: 'https://www.acefitness.org/resources/everyone/blog/8650/resistance-training-workouts-for-beginners/', description: 'Understand the basics of resistance training and explore beginner gym and home workouts.', category: 'Training', source: 'American Council on Exercise', minutes: 8 },
  { id: 'exercise-library', title: 'Find your form', url: 'https://www.acefitness.org/resources/everyone/exercise-library/', description: 'Look up exercise setup and technique in a movement library.', category: 'Technique', source: 'American Council on Exercise', minutes: 5 },
  { id: 'beginner-guide', title: 'Your first training program', url: 'https://thefitness.wiki/routines/r-fitness-basic-beginner-routine/', description: 'Learn how a short, alternating full-body routine is organized.', category: 'Training', source: 'The Fitness Wiki', minutes: 6 },
  { id: 'upper-lower-guide', title: 'Understand an upper / lower split', url: 'https://www.muscleandstrength.com/workouts/upper-lower-4-day-gym-bodybuilding-workout', description: 'Explore the source routine behind the four-day starter template.', category: 'Training', source: 'Muscle & Strength', minutes: 7 },
  { id: 'protein-guide', title: 'Protein and your training', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/', description: 'Read the sports nutrition position paper that informs the proposed protein calculator.', category: 'Nutrition', source: 'ISSN', minutes: 12 }
];

// These are explicit preview fixtures, not a live USDA/Open Food Facts integration.
export const foods: Food[] = [
  { id: 'muesli', name: 'Muesli', serving: '40 g', calories: 150, protein: 4, carbs: 28, fat: 3, source: 'Preview food catalogue' },
  { id: 'milk', name: 'Lactose Free Milk', serving: '100 ml', calories: 50, protein: 3.5, carbs: 5, fat: 1.5, source: 'Preview food catalogue' },
  { id: 'banana', name: 'Banana', serving: '1 medium', calories: 105, protein: 1.3, carbs: 27, fat: 0.4, source: 'Preview food catalogue' },
  { id: 'chicken-rice', name: 'Chicken Rice', serving: '1 bowl', calories: 550, protein: 30, carbs: 65, fat: 18, source: 'Preview food catalogue' },
  { id: 'greek-yogurt', name: 'Greek Yogurt', serving: '170 g', calories: 100, protein: 17, carbs: 6, fat: 0.7, source: 'Preview food catalogue' },
  { id: 'egg', name: 'Boiled Egg', serving: '1 large', calories: 78, protein: 6, carbs: 0.6, fat: 5, source: 'Preview food catalogue' },
  { id: 'rice', name: 'Cooked White Rice', serving: '100 g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, source: 'Preview food catalogue' },
  { id: 'salmon', name: 'Grilled Salmon', serving: '100 g', calories: 208, protein: 22, carbs: 0, fat: 13, source: 'Preview food catalogue' },
  { id: 'avocado', name: 'Avocado', serving: '100 g', calories: 160, protein: 2, carbs: 9, fat: 15, source: 'Preview food catalogue' },
  { id: 'oats', name: 'Rolled Oats', serving: '40 g', calories: 152, protein: 5, carbs: 27, fat: 3, source: 'Preview food catalogue' },
  { id: 'coffee', name: 'Black Coffee', serving: '1 cup', calories: 2, protein: 0.3, carbs: 0, fat: 0, source: 'Preview food catalogue' },
  { id: 'protein-shake', name: 'Protein Shake', serving: '1 scoop', calories: 120, protein: 24, carbs: 3, fat: 2, source: 'Preview food catalogue' }
];

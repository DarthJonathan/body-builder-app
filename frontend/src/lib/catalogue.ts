import sourceGuides from './exercise-guides.json';
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
  ['hanging-leg-raise', 'Hanging Leg Raises', ['core'], 'Pull-up bar', false]
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
export const templates: ProgramTemplate[] = [
  {
    id: 'upper-lower-4', name: '4-Day Upper / Lower', level: 'Beginner', goal: 'build-muscle', daysPerWeek: 4,
    equipment: 'Barbell, dumbbells, cables & machines', description: 'A balanced gym split with two upper and two lower sessions. Preview the original routine and make it yours.',
    source: 'https://www.muscleandstrength.com/workouts/upper-lower-4-day-gym-bodybuilding-workout',
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
    workouts: [templateWorkout('beginner-a', 'Full Body A', [rx('barbell-row', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('bench-press', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('squat', 3, 5, 5, { amrapLast: true, restSeconds: 180 })]), templateWorkout('beginner-b', 'Full Body B', [rx('chinup', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('overhead-press', 3, 5, 5, { amrapLast: true, restSeconds: 180 }), rx('deadlift', 3, 5, 5, { amrapLast: true, restSeconds: 180 })])]
  }
];

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

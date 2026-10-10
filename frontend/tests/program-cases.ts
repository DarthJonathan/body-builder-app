import { readFileSync } from 'node:fs';
import type { ProgramTemplate, Exercise } from '../src/lib/domain';

// The mock unit suite checks this exported catalogue against the frontend.
// Reading JSON here keeps browser-test setup independent of Vite JSON imports.
const { templates, exercises }: { templates: ProgramTemplate[]; exercises: Exercise[] } = JSON.parse(
  readFileSync(new URL('../../backend/catalogue/catalogue.json', import.meta.url), 'utf8')
);

export const addedProgramCases = [
  ['phul-4', 2], ['ppl-6', 1], ['barbell-5x5-3', 1], ['glute-focus-3', 2], ['dumbbell-full-body-3', 0]
].map(([id, previewIndex]) => {
  const template = templates.find(template => template.id === id)!;
  const workout = template.workouts[Number(previewIndex)];
  const exercise = exercises.find(exercise => exercise.id === workout.exercises[0].exerciseId)!;
  return { template, previewIndex: Number(previewIndex), workout, exercise };
});

import { exercises, muscles, foods, templates } from '../catalogue';
import { applyProgramImport, documentFromProgram, sameProgramDocument, templateFromDocument, validateProgramDocument } from '../program-documents';
import type { ProgramTemplate } from '../domain';
import type { AppSnapshot, MealEstimate, Program, TrainingClient, Workout, WorkoutSession } from '../domain';
import { id, sumNutrients } from '../domain';
import { calculateNutritionTargets, sameCalculationProvenance } from '../nutrition';
import { MockApiError, invalid, missing } from './errors';
import { createFixture } from './fixtures';
import {
  activeEmail, clone, delayAndMaybeFail, previewToday, readSnapshot,
  setActiveEmail, writeSnapshot
} from './storage';
import * as validate from './validation';
import { previewGoal, applyGoalCreation, validateGoalAnswers } from '../goals';
import { recommendPrograms, previewExpertGoal, EXPERT_GOAL_VERSION } from '../expert';
import { reviewProgress } from '../progress-review';
import { validateHealthEnergy } from '../health';

function allWorkouts(data: AppSnapshot): Workout[] {
  return data.programs.flatMap(program => program.workouts);
}

function samePrescription(left: WorkoutSession['exercises'][number]['prescription'], right: WorkoutSession['exercises'][number]['prescription']): boolean {
  const keys = ['id', 'exerciseId', 'sets', 'repsMin', 'repsMax', 'perSide', 'seconds', 'amrapLast', 'restSeconds', 'superset'] as const;
  return keys.every(key => left[key] === right[key]);
}

function ensureKnownExercises(program: Program) {
  for (const workout of program.workouts) {
    for (const prescription of workout.exercises) {
      if (!exercises.some(exercise => exercise.id === prescription.exerciseId)) invalid('Choose an exercise from the preview exercise library.');
    }
  }
}

function ensureSnapshot(email: string): AppSnapshot {
  const saved = readSnapshot(email);
  if (saved) return saved;
  const created = createFixture(email);
  writeSnapshot(email, created);
  return created;
}

function upsert<T extends { id: string }>(values: T[], value: T): void {
  const index = values.findIndex(item => item.id === value.id);
  if (index === -1) values.push(value);
  else values[index] = value;
}

/** A unique date is authoritative; historical entries retain their original IDs. */
function upsertDate<T extends { id: string; date: string }>(values: T[], value: T, prefix: string): T {
  const existing = values.find(item => item.date === value.date);
  const otherDate = values.some(item => item.id === value.id && item.date !== value.date);
  const result = { ...value, id: existing?.id ?? (otherDate ? id(prefix) : value.id) };
  if (existing) values[values.indexOf(existing)] = result;
  else values.push(result);
  values.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

function makeSession(workout: Workout, date: string): WorkoutSession {
  return {
    id: id('session'), workoutId: workout.id, name: workout.name, date,
    startedAt: new Date().toISOString(), finishedAt: null, restDeadline: null, restDuration: 90,
    exercises: workout.exercises.map(prescription => ({
      id: id('session-exercise'), exerciseId: prescription.exerciseId,
      prescription: clone(prescription), notes: '',
      sets: Array.from({ length: prescription.sets }, () => ({
        id: id('set'), weight: 0, reps: 0, effort: null, completed: false
      }))
    }))
  };
}

function privateTemplate(template: Program): Program {
  const copy: Program = {
    id: id('program'), name: template.name, goal: template.goal,
    level: template.level, source: template.source,
    sourceName: template.sourceName, sourceReviewedAt: template.sourceReviewedAt,
    adaptationNote: template.adaptationNote,
    workouts: template.workouts.map(workout => {
      const groups = new Map<string, string>();
      return {
        ...clone(workout), id: id('workout'),
        exercises: workout.exercises.map(prescription => {
          const copy = { ...clone(prescription), id: id('prescription') };
          if (copy.superset) {
            if (!groups.has(copy.superset)) groups.set(copy.superset, id('superset'));
            copy.superset = groups.get(copy.superset)!;
          }
          return copy;
        })
      };
    })
  };
  if(template.details) copy.details={...clone(template.details),key:`copy-${copy.id}`};
  return copy;
}

const SHARED_PROGRAMS='bodybuilder.preview.shared-programs.v1';
function previewTemplates(): ProgramTemplate[] {
  const saved=JSON.parse(window.localStorage.getItem(SHARED_PROGRAMS) ?? '[]') as ProgramTemplate[];
  const result=clone(templates);
  for(const template of saved) {const at=result.findIndex(t=>t.id===template.id);if(at<0)result.push(template);else result[at]=template;}
  return result;
}

export function createMockClient(): TrainingClient {
  // Mutations are serialized so two simultaneous saves cannot overwrite each other.
  let pending: Promise<unknown> = Promise.resolve();

  function request<T>(operation: string, handler: (email: string) => T | Promise<T>, authenticated = true): Promise<T> {
    let capturedEmail: string | null = null;
    let captureError: unknown;
    try { if (authenticated) capturedEmail = activeEmail(); } catch (error) { captureError = error; }
    const run = async () => {
      if (captureError) throw captureError;
      await delayAndMaybeFail(operation);
      if (authenticated) {
        if (!capturedEmail) throw new MockApiError('Sign in to your local preview to continue.', 401, 'not_signed_in');
        if (activeEmail() !== capturedEmail) throw new MockApiError('Your preview account changed. Open the record in the current account and try again.', 409, 'account_changed');
      }
      const value = await handler(capturedEmail ?? '');
      if(authenticated && activeEmail()!==capturedEmail) throw new MockApiError('Your preview account changed. Try again.',409,'account_changed');
      return clone(value);
    };
    const result = pending.then(run, run);
    pending = result.then(() => undefined, () => undefined);
    return result;
  }

  function mutate(operation: string, handler: (data: AppSnapshot) => void | Promise<void>): Promise<AppSnapshot> {
    return request(operation, async email => {
      const data = ensureSnapshot(email);
      await handler(data);
      if(activeEmail()!==email) throw new MockApiError('Your preview account changed. Try again.',409,'account_changed');
      writeSnapshot(email, data);
      return data;
    });
  }

  return {
    getSnapshot() {
      return request('getSnapshot', email => ensureSnapshot(email));
    },
    getAcknowledgedSnapshot() {
      return request('getAcknowledgedSnapshot', email => ensureSnapshot(email));
    },

    signIn(email, displayName) {
      return request('signIn', () => {
        const normalizedEmail = validate.email(email);
        if (displayName !== undefined) validate.string(displayName, 'Display name', 80, true);
        const data = readSnapshot(normalizedEmail) ?? createFixture(normalizedEmail, displayName);
        writeSnapshot(normalizedEmail, data);
        setActiveEmail(normalizedEmail);
        return data;
      }, false);
    },

    signOut() {
      return request('signOut', () => setActiveEmail(null), false);
    },

    resetPreview() {
      return request('resetPreview', email => {
        let displayName: string | undefined;
        try { displayName = readSnapshot(email)?.profile.displayName; } catch { /* Reset can repair corrupt preview data. */ }
        const data = createFixture(email, displayName);
        writeSnapshot(email, data);
        return data;
      });
    },

    updateProfile(patch) {
      return mutate('updateProfile', data => {
        validate.record(patch, 'Profile changes');
        const allowed = ['id', 'displayName', 'email', 'timezone', 'unit', 'goal', 'startWeight', 'goalStartedAt', 'role'];
        if (Object.keys(patch).some(key => !allowed.includes(key))) invalid('The profile changes contain an unsupported field.');
        for (const key of ['id', 'email', 'role'] as const) {
          if (patch[key] !== undefined && patch[key] !== data.profile[key]) {
            throw new MockApiError('Account identity and role cannot be changed through profile settings.', 403, 'identity_change_forbidden');
          }
        }
        const profile = { ...data.profile, ...clone(patch) };
        validate.profile(profile);
        profile.displayName = profile.displayName.trim();
        data.profile = profile;
      });
    },

    saveProgram(program) {
      return mutate('saveProgram', data => {
        validate.program(program); ensureKnownExercises(program);
        if(program.details && data.programs.some(p=>p.id!==program.id && p.details?.key===program.details!.key)) invalid('A program key already belongs to another private program.');
        const otherWorkouts = data.programs.filter(item => item.id !== program.id).flatMap(item => item.workouts);
        if (program.workouts.some(workout => otherWorkouts.some(other => other.id === workout.id))) {
          invalid('A workout ID belongs to another program. Copy the template before editing it.');
        }
        upsert(data.programs, clone(program));
        data.activeProgramId = program.id;
      });
    },
    importProgram(document) { return mutate('importProgram',data=>applyProgramImport(data,document,exercises,muscles)); },
    listProgramTemplates() { return request('listProgramTemplates',()=>previewTemplates()); },
    publishProgram(document,baseRevision) { return request('publishProgram',email=>{
      if(ensureSnapshot(email).profile.role!=='admin') throw new MockApiError('Only an administrator can publish shared programs.',403,'admin_required');
      validateProgramDocument(document,new Set(exercises.map(e=>e.id)));
      const existing=previewTemplates().find(t=>t.id===document.key);
      if(existing?.revision && existing.details && sameProgramDocument(documentFromProgram(existing),document)) return existing;
      if((existing?.revision ?? 0)!==baseRevision) throw new MockApiError('Another administrator updated this template. Reload the library before publishing.',409,'library_revision_conflict');
      if(existing && !existing.details) invalid('Use a new key for a source-based legacy template.');
      if(existing?.details && !sameProgramDocument(documentFromProgram(existing),document) && document.version<=existing.details.version) throw new MockApiError('Increase the document version before updating this template.',409,'program_version_conflict');
      const result=templateFromDocument(document,exercises,muscles,(existing?.revision ?? 0)+1);
      const saved=JSON.parse(window.localStorage.getItem(SHARED_PROGRAMS) ?? '[]') as ProgramTemplate[];
      if(!saved.some(p=>p.id===document.key) && saved.length>=200) invalid('The shared library already has 200 published templates.');
      upsert(saved,result);window.localStorage.setItem(SHARED_PROGRAMS,JSON.stringify(saved));return result;
    }); },

    recommendPrograms(input) { return request('recommendPrograms', email => recommendPrograms(input,previewTemplates(),ensureSnapshot(email).programs)); },
    reviewProgress() { return request('reviewProgress', email => reviewProgress(ensureSnapshot(email),previewToday())); },
    previewGoalPlan(input) { return request('previewGoalPlan', email => {
      const data = ensureSnapshot(email); validateGoalAnswers(input); if(input.trainingPriority) return previewExpertGoal(input,previewTemplates(),data); return previewGoal(input, data.programs.find(p=>p.id===data.activeProgramId));
    }); },
    createGoalPlan(input) { return mutate('createGoalPlan', async data => { const preview=input.version===EXPERT_GOAL_VERSION ? await previewExpertGoal(input.answers,previewTemplates(),data) : undefined; applyGoalCreation(data,input,previewToday(),preview); }); },
    saveHealthEnergy(energy) { return mutate('saveHealthEnergy', data => { if (energy) validateHealthEnergy(energy); data.healthEnergy=energy ? clone(energy) : undefined; }); },
    useTemplate(templateId) {
      return mutate('useTemplate', data => {
        validate.identifier(templateId, 'Template ID');
        const template = previewTemplates().find(item => item.id === templateId);
        if (!template) missing('That starter program is not available in the preview.');
        const program = privateTemplate(template);
        validate.program(program); ensureKnownExercises(program);
        data.programs.push(program); data.activeProgramId = program.id;
        // Selecting a template never silently changes the user's calendar.
      });
    },

    assignWorkout(date, workoutId) {
      return mutate('assignWorkout', data => {
        validate.date(date);
        if (workoutId !== null) {
          validate.identifier(workoutId, 'Workout ID');
          if (!allWorkouts(data).some(item => item.id === workoutId)) missing('That workout is not available in this preview account.');
        }
        upsertDate(data.schedule, { id: id('schedule'), date, workoutId }, 'schedule');
      });
    },

    startWorkout(workoutId, date) {
      return mutate('startWorkout', data => {
        validate.identifier(workoutId, 'Workout ID'); validate.date(date);
        const workout = allWorkouts(data).find(item => item.id === workoutId);
        if (!workout) missing('That workout is not available in this preview account.');
        if (!workout.exercises.length) invalid('Add an exercise before starting this workout.');
        const running = data.sessions.find(item => !item.finishedAt);
        if (running && (running.workoutId !== workoutId || running.date !== date)) {
          throw new MockApiError('Finish your active workout before starting another one.', 409, 'session_already_active');
        }
        if (!running) data.sessions.push(makeSession(workout, date));
        upsertDate(data.schedule, { id: id('schedule'), date, workoutId }, 'schedule');
      });
    },

    saveSession(session) {
      return mutate('saveSession', data => {
        validate.session(session);
        const existing = data.sessions.find(item => item.id === session.id);
        if (!existing) missing('That workout session is not available in this preview account.');
        for (const key of ['workoutId', 'name', 'date', 'startedAt', 'finishedAt'] as const) {
          if (existing[key] !== session[key]) invalid('Session timing and identity are fixed. Use Finish to complete the workout.');
        }
        for (const item of session.exercises) {
          const original = existing.exercises.find(exercise => exercise.id === item.id);
          if (!original || original.exerciseId !== item.exerciseId || !samePrescription(original.prescription, item.prescription)) {
            invalid('Session prescriptions are snapshots. Edit your program for the next workout.');
          }
        }
        if (session.exercises.length !== existing.exercises.length) invalid('Session prescriptions are snapshots. Edit your program for the next workout.');
        upsert(data.sessions, clone(session));
      });
    },

    finishSession(sessionId) {
      return mutate('finishSession', data => {
        validate.identifier(sessionId, 'Session ID');
        const session = data.sessions.find(item => item.id === sessionId);
        if (!session) missing('That workout session is not available in this preview account.');
        session.finishedAt ??= new Date().toISOString();
        session.restDeadline = null;
      });
    },

    saveFood(entry) {
      return mutate('saveFood', data => {
        validate.foodEntry(entry);
        if (entry.foodId && !foods.some(food => food.id === entry.foodId)) invalid('That food is not in the preview catalogue. Use a manual entry instead.');
        upsert(data.foodEntries, { ...clone(entry), name: entry.name.trim(), serving: entry.serving.trim() });
      });
    },

    deleteFood(recordId) {
      return mutate('deleteFood', data => {
        validate.identifier(recordId);
        if (!data.foodEntries.some(item => item.id === recordId)) missing('That food entry is not available in this preview account.');
        data.foodEntries = data.foodEntries.filter(item => item.id !== recordId);
      });
    },

    copyFoods(fromDate, toDate) {
      return mutate('copyFoods', data => {
        validate.date(fromDate, 'Source date'); validate.date(toDate, 'Destination date');
        if (fromDate === toDate) invalid('Choose a different date to copy meals to.');
        const entries = data.foodEntries.filter(item => item.date === fromDate);
        if (!entries.length) missing('There are no logged foods on that date to copy.');
        data.foodEntries.push(...entries.map(entry => ({ ...clone(entry), id: id('food'), date: toDate })));
      });
    },

    searchFoods(query) {
      return request('searchFoods', () => {
        validate.string(query, 'Food search', 200, true);
        const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return foods.filter(food => terms.every(term => `${food.name} ${food.serving}`.toLowerCase().includes(term))).slice(0, 30);
      });
    },

    saveTargets(targets) {
      return mutate('saveTargets', data => {
        validate.targets(targets, true);
        const existing = data.targets.find(item => item.effectiveDate === targets.effectiveDate);
        const copy = clone(targets);
        if (copy.mode === 'manual' && existing?.calculation) {
          if (copy.calculation && !sameCalculationProvenance(copy.calculation, existing.calculation)) invalid('A manual override must retain the original calculation. Calculate targets again to replace it.');
          copy.calculation = clone(existing.calculation);
          copy.manuallyOverridden = true;
        }
        const otherDate = data.targets.some(item => item.id === targets.id && item.effectiveDate !== targets.effectiveDate);
        const value = { ...copy, id: existing?.id ?? (otherDate ? id('targets') : targets.id) };
        if (existing) data.targets[data.targets.indexOf(existing)] = value;
        else data.targets.push(value);
        data.targets.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
      });
    },
    calculateTargets(input) {
      return request('calculateTargets', () => calculateNutritionTargets(input, id('targets')));
    },

    saveCheckIn(checkIn) {
      return mutate('saveCheckIn', data => {
        validate.checkIn(checkIn);
        upsertDate(data.checkIns, clone(checkIn), 'checkin');
        upsertDate(data.weights, { id: id('weight'), date: checkIn.date, weight: checkIn.weight }, 'weight');
      });
    },

    saveWeight(entry) {
      return mutate('saveWeight', data => {
        validate.weight(entry); upsertDate(data.weights, clone(entry), 'weight');
        const checkIn = data.checkIns.find(item => item.date === entry.date);
        if (checkIn) checkIn.weight = entry.weight;
      });
    },

    saveLesson(lesson) {
      return mutate('saveLesson', data => {
        validate.lesson(lesson);
        upsert(data.lessons, { ...clone(lesson), title: lesson.title.trim(), url: lesson.url.trim(), category: lesson.category.trim() });
      });
    },

    deleteLesson(recordId) {
      return mutate('deleteLesson', data => {
        validate.identifier(recordId);
        if (!data.lessons.some(item => item.id === recordId)) missing('That lesson is not available in this preview account.');
        data.lessons = data.lessons.filter(item => item.id !== recordId);
      });
    },

    saveProvider(config) {
      return mutate('saveProvider', data => {
        if (data.profile.role !== 'admin') throw new MockApiError('Only a preview admin can edit provider settings.', 403, 'admin_required');
        validate.provider(config); data.provider = { ...clone(config), model: config.model.trim() };
      });
    },

    askQuestion(question) {
      return request('askQuestion', email => {
        validate.string(question, 'Question', 5_000);
        const data = ensureSnapshot(email);
        if (!data.provider.enabled) throw new MockApiError('The assistant is turned off in preview settings.', 503, 'provider_disabled');
        const query = question.toLowerCase();
        let answer: string;
        if (/food|nutrition|calorie|macro|protein/.test(query)) {
          const totals = sumNutrients(data.foodEntries.filter(item => item.date === previewToday()));
          answer = `Your current food log contains ${Math.round(totals.calories)} calories and ${Math.round(totals.protein)} g protein today. You can review individual servings in Nutrition and adjust your dated targets in settings.`;
        } else if (/effort|rpe|easy|medium|hard/.test(query)) {
          answer = 'Record how the set felt using Easy, Medium, or Hard. These are your own effort labels; use the separate checkmark to record completion.';
        } else if (/rest|timer/.test(query)) {
          answer = 'Each exercise has a rest duration in your program. Tap Rest during a workout to start the timer, and adjust its duration to suit your session.';
        } else {
          const exercise = exercises.find(item => item.name.toLowerCase().split(/\s+/).filter(word => word.length > 4).some(word => query.includes(word)));
          answer = exercise ? `${exercise.name}: ${exercise.instructions.join(' ')}` : 'Use your program to choose today’s session, log the weight and reps for each set, and record the effort you felt. Your lesson library has links and notes you can return to before training.';
        }
        return { answer: `Simulated preview answer: ${answer}`, preview: true as const };
      });
    },

    estimateMeal(image) {
      return request('estimateMeal', email => {
        const data = ensureSnapshot(email);
        if (!data.provider.enabled) throw new MockApiError('The assistant is turned off in preview settings.', 503, 'provider_disabled');
        if (!image || typeof image.size !== 'number' || typeof image.type !== 'string') invalid('Choose a meal photo first.');
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'].includes(image.type)) invalid('Choose a JPEG, PNG, WebP, GIF, HEIC, or AVIF meal photo.');
        if (image.size <= 0 || image.size > 10 * 1_024 * 1_024) invalid('Choose a meal photo smaller than 10 MB.');
        const estimate: MealEstimate = {
          preview: true,
          assumptions: 'Simulated example only: this local preview has not analysed your photo. Portions and nutrition below illustrate the review flow. Adjust the items and quantities before choosing to save them.',
          items: [
            { name: 'Chicken breast', quantity: 1, serving: '150 g', calories: 248, protein: 46.5, carbs: 0, fat: 5.4 },
            { name: 'Cooked white rice', quantity: 1, serving: '160 g', calories: 208, protein: 4.3, carbs: 44.8, fat: 0.5 },
            { name: 'Mixed vegetables', quantity: 1, serving: '100 g', calories: 50, protein: 2, carbs: 10, fat: 0.5 }
          ]
        };
        return estimate;
      });
    }
  };
}

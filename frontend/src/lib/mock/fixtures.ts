import { exercises, previewWorkouts, readings } from '../catalogue';
import type { AppSnapshot, Program, Workout, WorkoutSession } from '../domain';
import { id, shiftDate } from '../domain';
import { clone, DEFAULT_PREVIEW_EMAIL, previewToday } from './storage';

export function referenceProgram(): Program {
  return { id: 'preview-program', name: 'Female Intermediate: 4-Day ULUL', level: 'Intermediate', goal: 'build-muscle', workouts: clone(previewWorkouts) };
}

function dateTime(date: string, hour: number, minute = 0): string {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).toISOString();
}

function completedSession(workout: Workout, date: string, sequence: number): WorkoutSession {
  const sessionId = `preview-session-${date}`;
  return {
    id: sessionId, workoutId: workout.id, name: workout.name, date,
    startedAt: dateTime(date, 17), finishedAt: dateTime(date, 17, 45), restDeadline: null, restDuration: 90,
    exercises: workout.exercises.map((item, index) => ({
      id: `${sessionId}-exercise-${index}`, exerciseId: item.exerciseId, prescription: clone(item), notes: '',
      sets: Array.from({ length: item.sets }, (_, setIndex) => ({
        id: `${sessionId}-set-${index}-${setIndex}`, weight: exercises.find(exercise => exercise.id === item.exerciseId)?.weighted ? 10 + index * 5 + sequence : 0,
        reps: item.repsMin + Math.min(2, item.repsMax - item.repsMin), effort: setIndex === item.sets - 1 ? 'hard' : 'medium', completed: true
      }))
    }))
  };
}

export function createFixture(email: string, displayName?: string): AppSnapshot {
  const today = previewToday();
  const program = referenceProgram();
  const localName = email.split('@')[0].split(/[._-]/).filter(Boolean).map(part => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
  const name = displayName?.trim() || (email === DEFAULT_PREVIEW_EMAIL ? 'Nathan' : (localName || 'Your').slice(0, 80));
  const schedule = Array.from({ length: 29 }, (_, index) => {
    const date = shiftDate(today, index - 21);
    return { id: `preview-schedule-${date}`, date, workoutId: null as string | null };
  });
  const sessions: WorkoutSession[] = [];
  // Historical planned days are marked complete only when the matching session exists.
  for (let offset = -20; offset < 0; offset++) {
    const date = shiftDate(today, offset);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    if (weekday !== 1 && weekday !== 3) continue;
    const workout = program.workouts.find(item => item.name === (weekday === 1 ? 'Lower 1' : 'Upper 2'))!;
    schedule.find(item => item.date === date)!.workoutId = workout.id;
    sessions.push(completedSession(workout, date, sessions.length));
  }
  schedule.find(item => item.date === today)!.workoutId = 'lower-2';
  schedule.find(item => item.date === shiftDate(today, 1))!.workoutId = 'upper-1';
  const weights = Array.from({ length: 15 }, (_, index) => ({
    id: `preview-weight-${shiftDate(today, index - 14)}`,
    date: shiftDate(today, index - 14), weight: Math.round((55.2 + index * 1.3 / 14) * 10) / 10
  }));
  return {
    profile: {
      id: id('preview-user'), displayName: name, email,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', unit: 'kg',
      goal: 'build-muscle', startWeight: 55, goalStartedAt: shiftDate(today, -21),
      role: email === DEFAULT_PREVIEW_EMAIL ? 'admin' : 'user'
    },
    programs: [program], activeProgramId: program.id, schedule, sessions,
    foodEntries: [
      { id: 'preview-food-breakfast', name: 'Muesli & lactose-free milk', date: today, meal: 'Breakfast', quantity: 1, serving: 'bowl', source: 'manual', calories: 170, protein: 8, carbs: 25, fat: 4 },
      { id: 'preview-food-lunch', name: 'Chicken avocado bowl', date: today, meal: 'Lunch', quantity: 1, serving: 'bowl', source: 'manual', calories: 768, protein: 25, carbs: 54, fat: 51 },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `preview-food-history-${index}`, name: 'Daily food log', date: shiftDate(today, -(index + 1)), meal: 'Dinner' as const,
        quantity: 1, serving: 'day of preview meals', source: 'manual' as const,
        calories: index === 0 ? 1_441 : index === 1 ? 1_658 : 1_900 + index * 30,
        protein: 82 + index, carbs: 160 + index * 3, fat: 49 + index
      }))
    ],
    // Illustrative values reproduce the supplied preview, not a nutrition policy.
    targets: [{ id: 'preview-targets', effectiveDate: shiftDate(today, -21), mode: 'calculated', manuallyOverridden: false, calories: 2_220, protein: 100, carbs: 300, fat: 65 }],
    weights,
    checkIns: [1, 2, 3].map(daysAgo => ({
      id: `preview-checkin-${daysAgo}`, date: shiftDate(today, -daysAgo),
      weight: weights.find(item => item.date === shiftDate(today, -daysAgo))!.weight,
      notes: daysAgo === 1 ? 'Felt good after training.' : ''
    })),
    lessons: readings.slice(0, 2).map((reading, index) => ({
      id: `preview-lesson-${reading.id}`, title: reading.title, url: reading.url, category: reading.category,
      source: reading.source, notes: index === 0 ? 'Keep these cues in mind for my next session.' : '',
      completed: index === 0, savedAt: dateTime(shiftDate(today, -3 + index), 12)
    })),
    provider: { provider: 'openai', model: 'Preview model', enabled: true, configured: false }
  };
}

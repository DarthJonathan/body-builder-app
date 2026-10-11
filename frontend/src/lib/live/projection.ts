import type { AppSnapshot, CheckIn, FoodEntry, Lesson, NutritionTargets, Profile, Program, WeightEntry, WorkoutSession } from '../domain';
import { clone, type PendingMutation } from './storage';
function upsert<T extends { id: string }>(items: T[], next: T): void {
  const at = items.findIndex(item => item.id === next.id);
  if (at < 0) items.push(next); else items[at] = next;
}
function dated<T extends { id: string; date: string }>(items: T[], next: T, fallbackId: string): void {
  const existing = items.find(item => item.date === next.date);
  const reused = items.some(item=>item.id===next.id && item.date!==next.date);
  upsert(items, { ...next, id: existing?.id ?? (reused ? fallbackId : next.id) });
}
/** Only records whose identifiers are already known can be projected before acknowledgement. */
export function project(server: AppSnapshot, outbox: PendingMutation[]): AppSnapshot {
  const result = clone(server);
  for (const mutation of outbox) {
    const payload = clone(mutation.payload);
    switch (mutation.operation) {
      case 'updateProfile': {
        const patch = payload as Partial<Profile>;
        const { id, email, role } = result.profile;
        result.profile = { ...result.profile, ...patch, id, email, role }; break;
      }
      case 'saveProgram': {
        const program = payload as Program; upsert(result.programs, program); result.activeProgramId = program.id; break;
      }
      case 'assignWorkout': {
        const entry = payload as { date: string; workoutId: string | null };
        dated(result.schedule, { ...entry, id: `schedule-${entry.date}` }, `schedule-${mutation.id}`); break;
      }
      case 'saveSession': upsert(result.sessions, payload as WorkoutSession); break;
      case 'finishSession': {
        const finish=payload as {sessionId:string;finishedAt?:string};
        const session = result.sessions.find(item => item.id === finish.sessionId);
        if (session && !session.finishedAt) { session.finishedAt = finish.finishedAt ?? mutation.createdAt; session.restDeadline = null; }
        break;
      }
      case 'saveFood': upsert(result.foodEntries, payload as FoodEntry); break;
      case 'deleteFood': result.foodEntries = result.foodEntries.filter(item => item.id !== (payload as { id: string }).id); break;
      case 'saveTargets': {
        const target = payload as NutritionTargets;
        const current = result.targets.find(item => item.effectiveDate === target.effectiveDate);
        const reused=result.targets.some(item=>item.id===target.id && item.effectiveDate!==target.effectiveDate);
        upsert(result.targets, { ...target, id: current?.id ?? (reused ? `targets-${mutation.id}` : target.id) }); break;
      }
      case 'saveCheckIn': {
        const checkIn = payload as CheckIn; dated(result.checkIns, checkIn, `checkin-${mutation.id}`);
        dated(result.weights, { id: `weight-${checkIn.id}`, date: checkIn.date, weight: checkIn.weight }, `weight-${mutation.id}`); break;
      }
      case 'saveWeight': {
        const weight = payload as WeightEntry; dated(result.weights, weight, `weight-${mutation.id}`);
        const checkIn = result.checkIns.find(item => item.date === weight.date);
        if (checkIn) checkIn.weight = weight.weight; break;
      }
      case 'saveLesson': upsert(result.lessons, payload as Lesson); break;
      case 'deleteLesson': result.lessons = result.lessons.filter(item => item.id !== (payload as { id: string }).id); break;
      case 'saveHealthEnergy': result.healthEnergy = (payload as {energy: AppSnapshot['healthEnergy'] | null}).energy ?? undefined; break;
      case 'importProgram': case 'createGoalPlan': case 'useTemplate': case 'startWorkout': case 'copyFoods': break;
    }
  }
  return result;
}

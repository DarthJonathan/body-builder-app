import rules from './expert-rules.json';
import { exercises } from './catalogue';
import { shiftDate, targetsForDate } from './domain';
import type { AppSnapshot, Prescription, ProgressReview } from './domain';

const rounded = (n:number) => Math.round((n+Number.EPSILON)*100)/100;
const sameDose = (a:Prescription,b:Prescription) => (['id','key','exerciseId','sets','repsMin','repsMax','seconds','perSide','amrapLast','restSeconds','superset'] as const).every(k=>(a[k] ?? false)===(b[k] ?? false));
/** Read-only observations. Labels are not RPE, and food entries do not prove complete daily intake. */
export function reviewProgress(data:AppSnapshot,asOf:string):ProgressReview {
  const p=data.programs.find(p=>p.id===data.activeProgramId);
  const r:ProgressReview={version:'progress-review-v1',asOf,programId:p?.id ?? '',programName:p?.name ?? '',training:[],trainingSummary:'Log complete working sets, load, repetitions and effort across repeated sessions to review progression.',nutrition:{status:'insufficient-data',message:'Record weight on at least three days in each of two weeks, plus consistent meal logs, before reviewing a trend.',evidence:[]},adherence:{scheduled:0,completed:0,windowDays:rules.progress.windowDays},policy:rules.reviewPolicy,sources:structuredClone(rules.sources)};
  const since=shiftDate(asOf,-rules.progress.windowDays+1);
  const sessions=data.sessions.filter(s=>s.finishedAt && s.date>=since && s.date<=asOf && s.finishedAt.slice(0,10)<=asOf);
  if(p) for(const w of p.workouts) for(const rx of w.exercises) {
    const exercise=exercises.find(e=>e.id===rx.exerciseId);
    if(!exercise?.weighted || rx.seconds || rx.amrapLast) continue;
    // Never skip the latest partial/failed exposure to find older successful sets.
    const seen=new Set<string>();
    const exposures=sessions.filter(s=>s.workoutId===w.id).sort((a,b)=>b.date.localeCompare(a.date)||b.startedAt.localeCompare(a.startedAt)).map(s=>({date:s.date,entry:s.exercises.find(e=>e.exerciseId===rx.exerciseId && e.prescription.id===rx.id)})).filter(x=>{if(!x.entry || seen.has(x.date))return false;seen.add(x.date);return true;});
    if(exposures.length<2 || exposures[0].date<shiftDate(asOf,-14))continue;
    const valid=(x:typeof exposures[number])=>!!x.entry && sameDose(x.entry.prescription,rx) && x.entry.sets.length===rx.sets && x.entry.sets.every(s=>s.completed && s.weight>0 && Number.isFinite(s.weight) && s.reps>0 && ['easy','medium','hard'].includes(s.effort ?? '') && s.weight===x.entry!.sets[0].weight);
    const ready=exposures.slice(0,rules.progress.increaseExposures);
    if(ready.length===rules.progress.increaseExposures && ready.every(valid) && ready.every(x=>x.entry!.sets[0].weight===ready[0].entry!.sets[0].weight && x.entry!.sets.every(s=>s.reps>=rx.repsMax && s.effort!=='hard'))) {
      const load=ready[0].entry!.sets[0].weight;
      r.training.push({workoutId:w.id,prescriptionId:rx.id,exerciseId:rx.exerciseId,name:exercise.name,kind:'increase-load',observedLoadKg:load,suggestedLoadKg:rounded(load*(1+rules.progress.increasePercent/100)),dates:ready.map(x=>x.date),message:'Consider the smallest available load increase, around 2.5%, while retaining controlled technique.',evidence:[`All ${rx.sets} sets reached at least ${rx.repsMax} reps at ${load} kg in two separate sessions.`,`Every set was marked easy or medium. These labels do not measure reps in reserve.`]});
    } else {
      const stalled=exposures.slice(0,rules.progress.stallExposures);
      if(stalled.length===rules.progress.stallExposures && stalled.every(valid) && stalled.every(x=>x.entry!.sets[0].weight===stalled[0].entry!.sets[0].weight && x.entry!.sets.every(s=>s.reps<rx.repsMin && s.effort==='hard'))) r.training.push({workoutId:w.id,prescriptionId:rx.id,exerciseId:rx.exerciseId,name:exercise.name,kind:'review-stall',observedLoadKg:stalled[0].entry!.sets[0].weight,dates:stalled.map(x=>x.date),message:'Review technique, rest and recovery. Consider a lighter load that lets you reach the prescribed minimum before adding more work.',evidence:[`All prescribed sets stayed below ${rx.repsMin} reps at the same load in three separate sessions.`,`Every set was marked hard; this is a prompt to review, not a diagnosis of a plateau.`]});
    }
  }
  if(r.training.length)r.trainingSummary=`${r.training.length} exercise${r.training.length===1?'':'s'} with enough repeated observations to review. Suggestions do not edit your program.`;
  const scheduled=data.schedule.filter(s=>s.date>=since && s.date<=asOf && s.workoutId);
  r.adherence.scheduled=scheduled.length;r.adherence.completed=scheduled.filter(s=>sessions.some(x=>x.date===s.date && x.workoutId===s.workoutId)).length;
  const dates=Array.from({length:14},(_,i)=>shiftDate(asOf,i-14));
  const weights=dates.map(date=>({date,weight:data.weights.find(w=>w.date===date)?.weight ?? data.checkIns.find(w=>w.date===date)?.weight ?? 0})).filter(w=>Number.isFinite(w.weight)&&w.weight>=30&&w.weight<=350);
  const first=weights.filter(w=>w.date<dates[7]),last=weights.filter(w=>w.date>=dates[7]);
  const meals=dates.map(date=>data.foodEntries.filter(f=>f.date===date && Number.isFinite(f.calories)&&f.calories>=0));
  const logged=meals.filter(entries=>new Set(entries.map(e=>e.meal)).size>=rules.nutrition.minimumMeals);
  r.nutrition.evidence=[`${first.length} weight days in the first week; ${last.length} in the second.`,`${logged.length} of 14 completed days have entries in at least two meal groups. This does not confirm that entire days were logged.`];
  if(logged.length)r.nutrition.averageLoggedCalories=rounded(logged.reduce((sum,e)=>sum+e.reduce((n,f)=>n+f.calories,0),0)/logged.length);
  if(first.length<rules.nutrition.weightsPerWeek || last.length<rules.nutrition.weightsPerWeek)return r;
  const avg=(items:typeof weights)=>items.reduce((n,w)=>n+w.weight,0)/items.length;
  const change=avg(last)-avg(first),percent=change/avg(first)*100;
  r.nutrition.weeklyChangeKg=rounded(change);r.nutrition.weeklyChangePercent=rounded(percent);
  r.nutrition.evidence.push(`Weekly average weight changed ${rounded(change)} kg (${rounded(percent)}%). Water and measurement conditions can affect this.`);
  const target=targetsForDate(data,asOf);
  if(!target.calculation || target.mode==='manual' || target.manuallyOverridden){r.nutrition.status='manual-targets';r.nutrition.message='Your targets are manual. Review this weight trend alongside your food log; your chosen targets remain unchanged.';return r;}
  if(dates.some(date=>targetsForDate(data,date).id!==target.id) || logged.length<rules.nutrition.loggedDays){r.nutrition.message='Review after two weeks with the same targets and at least ten days of consistent meal logs. Your current targets remain unchanged.';return r;}
  const unusual=Math.abs(percent)>rules.nutrition.maximumWeeklyChangePercent;
  const goal=target.calculation.input.goal;
  const mismatch=goal==='build-muscle' ? percent<=0 || percent>0.5 : goal==='lose-fat' ? percent>=0 || percent< -1 : Math.abs(percent)>0.5;
  r.nutrition.status=unusual || mismatch?'review-trend':'on-track';
  r.nutrition.message=unusual?'The weight change is unusually large. Verify weights, timing and logging before considering any calorie change.':mismatch?'The observed trend differs from this goal’s review band. If these entries represent full days, review your portions, recovery and calorie target; a small 100 kcal adjustment can be reassessed after another two weeks.':'The observed trend is within this goal’s initial review band. Keep logging and review training performance and recovery.';
  r.nutrition.evidence.push('BodyBuilder review bands: muscle gain above 0% up to 0.5% per week; fat loss below 0% down to −1%; maintenance within ±0.5%. These are prompts to review, not validated outcome predictions.');
  return r;
}

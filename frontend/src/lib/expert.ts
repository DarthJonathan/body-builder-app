import policy from './expert-rules.json';
import { exercises } from './catalogue';
import { documentFromProgram, validateProgramDocument } from './program-documents';
import { calculateNutritionTargets } from './nutrition';
import type { AppSnapshot, GoalAnswers, GoalPreview, Program, ProgramMatch, ProgramRecommendations, ProgramSelection, ProgramTemplate, TrainingPreferences } from './domain';

export const EXPERT_GOAL_VERSION = 'goal-library-v2' as const;
export const EXPERT_SOURCES = policy.sources;
const ranks = {beginner:0,intermediate:1,advanced:2};
const compareText=(a:string,b:string):number=>{const x=Array.from(a,c=>c.codePointAt(0)!),y=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
const copy = <T>(v:T):T => JSON.parse(JSON.stringify(v));
export function validateTrainingPreferences(a:TrainingPreferences):void {
  if(!a || typeof a!=='object' || Array.isArray(a) || Object.keys(a).some(k=>!['goal','experience','equipment','daysPerWeek','sessionMinutes','focus','trainingPriority'].includes(k))) throw new Error('Unsupported training preferences.');
  for(const [field,values] of Object.entries({goal:['build-muscle','maintain','lose-fat'],experience:['beginner','intermediate','advanced'],equipment:['full-gym','dumbbells'],focus:['balanced','glutes'],trainingPriority:['hypertrophy','strength','general']})) if(!values.includes(a[field as keyof TrainingPreferences] as string)) throw new Error(`Choose ${field}.`);
  if(!Number.isInteger(a.daysPerWeek) || a.daysPerWeek<2 || a.daysPerWeek>6 || ![30,45,60].includes(a.sessionMinutes)) throw new Error('Choose two to six training days and a 30, 45 or 60 minute time budget.');
}
export function trainingPreferences(a:GoalAnswers):TrainingPreferences {return {goal:a.goal,experience:a.experience,equipment:a.equipment,daysPerWeek:a.daysPerWeek,sessionMinutes:a.sessionMinutes,focus:a.focus,trainingPriority:a.trainingPriority ?? 'hypertrophy'};}
function normalize(v:unknown):unknown {
  if(Array.isArray(v)) return v.map(normalize);
  if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined && x!==null && x!==false).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,normalize(x)]));
  return v;
}
/** Bind reviewed content to creation. This digest is not a trust or authorization token. */
export async function programDigest(p:Program):Promise<string> {
  const content=p.details ? documentFromProgram(p) : p;
  const raw=JSON.stringify(normalize(content)).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function currentSelection(p:Program):Promise<ProgramSelection> {return {scope:'current',id:p.id,version:p.details?.version ?? 0,revision:0,digest:await programDigest(p)};}
export function selectionEqual(a:ProgramSelection|undefined,b:ProgramSelection|undefined):boolean {return !!a && !!b && a.scope===b.scope && a.id===b.id && a.version===b.version && a.revision===b.revision && a.digest===b.digest;}
export function validateSelection(s:ProgramSelection|undefined):void {
  if(!s || typeof s!=='object' || Array.isArray(s) || Object.keys(s).some(k=>!['scope','id','version','revision','digest'].includes(k)) || !['shared','personal','current'].includes(s.scope) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,179}$/.test(s.id) || !Number.isInteger(s.version) || s.version<0 || s.version>1000000 || !Number.isSafeInteger(s.revision) || s.revision<0 || !/^[a-f0-9]{64}$/.test(s.digest)) throw new Error('Review a current program recommendation first.');
}

export async function recommendPrograms(a:TrainingPreferences,shared:ProgramTemplate[],personal:Program[]):Promise<ProgramRecommendations> {
  validateTrainingPreferences(a);
  const result:ProgramRecommendations={version:'program-expert-v1',matches:[],excluded:[],explanation:'',policy:policy.matchingPolicy,sources:copy(policy.sources)};
  const known=new Set(exercises.map(e=>e.id));
  for(const [scope,items] of [['shared',shared],['personal',personal]] as const) for(const p of items) {
    const d=p.details,reasons:string[]=[];
    if(!d) reasons.push('Suitability metadata is missing; this program remains available for manual selection.');
    else {
      try{validateProgramDocument(documentFromProgram(p),known);}catch{reasons.push('The current prescriptions need a valid structured export before matching.');}
      if(d.daysPerWeek!==a.daysPerWeek || p.workouts.length!==a.daysPerWeek) reasons.push(`Needs ${p.workouts.length} training days; you selected ${a.daysPerWeek}.`);
      if(d.sessionMinutes>a.sessionMinutes) reasons.push(`Estimated ${d.sessionMinutes} minutes exceeds your ${a.sessionMinutes}-minute budget.`);
      if(!d.goals.includes(a.goal)) reasons.push('This program does not list your selected goal.');
      if(Math.min(...d.experience.map(e=>ranks[e]))>ranks[a.experience]) reasons.push('Its starting experience is higher than your reported level.');
      if(a.equipment==='dumbbells' && (d.equipment!=='dumbbells' || p.workouts.some(w=>w.exercises.some(r=>!policy.dumbbellEquipment.includes(exercises.find(e=>e.id===r.exerciseId)?.equipment ?? 'unknown'))))) reasons.push('Needs equipment beyond dumbbells and a bench.');
    }
    if(reasons.length){result.excluded.push({id:p.id,name:p.name,scope,reasons});continue;}
    const detail=d!,differences:string[]=[],why=[`Exactly ${a.daysPerWeek} workouts fit your training days.`,`The declared ${detail.sessionMinutes}-minute sessions fit your ${a.sessionMinutes}-minute budget.`,`Your equipment and ${a.goal.replaceAll('-',' ')} goal match.`];
    let score=detail.sessionMinutes===a.sessionMinutes ? policy.weights.time : policy.weights.time/2;
    if(detail.experience.includes(a.experience)){score+=policy.weights.experience;why.push('Your training experience is explicitly supported.');} else differences.push('Uses a lower starting dose than your reported experience; review whether it is challenging enough.');
    if(detail.focus===a.focus){score+=policy.weights.focus;why.push(a.focus==='glutes'?'Prioritizes your glute focus.':'Matches your balanced muscle focus.');}else differences.push(`Its ${detail.focus} focus differs from your ${a.focus} preference.`);
    if(detail.purpose===a.trainingPriority){score+=policy.weights.purpose;why.push(`Matches your ${a.trainingPriority} training priority.`);}else differences.push(`Uses a ${detail.purpose} emphasis rather than your ${a.trainingPriority} priority.`);
    const match:ProgramMatch={selection:{scope,id:p.id,version:detail.version,revision:scope==='shared'?(p as ProgramTemplate).revision ?? 0:0,digest:await programDigest(p)},program:copy(p),score,reasons:why,differences};
    result.matches.push(match);
  }
  result.matches.sort((a,b)=>b.score-a.score || compareText(a.program.name,b.program.name) || (a.selection.scope<b.selection.scope?-1:a.selection.scope>b.selection.scope?1:0) || (a.selection.id<b.selection.id?-1:a.selection.id>b.selection.id?1:0));
  result.explanation=result.matches.length?'Eligible programs are ranked by your preferences. Choose the recommendation or another eligible plan; no split is universally best.':'No library program meets all of these constraints. Change your days, time or equipment, import a suitable structured plan, or retain your current individually suitable workouts.';
  return result;
}

export function nutritionGuidance(a:GoalAnswers,p:Program):string[] {
  return [a.nutrition.healthEnergy ? 'Maintenance uses complete Apple Health resting + active energy days without adding an activity multiplier.' : 'Maintenance starts from Mifflin–St Jeor resting energy and your reported activity factor.',
    `${a.nutrition.calorieAdjustment} kcal/day is the starting goal adjustment; it is not a predicted rate of weight change.`,
    `Protein ${a.nutrition.proteinPerKg} g/kg; fat ${a.nutrition.fatPercent}% of calories; carbohydrate fills the remaining energy. Targets remain editable.`,
    p.details?.nutrition.instructions ?? 'Use your individual calorie and macro targets when logging food.',
    a.nutritionExperience==='new'?'Start with food search and measured portions. Log each meal and your daily weight before drawing conclusions from trends.':a.nutritionExperience==='familiar'?'Review daily calories and protein alongside your weight trend; record portions consistently.':'Compare consistent food logging, weekly weight averages and training performance; use manual overrides when appropriate.'];
}
export async function previewExpertGoal(a:GoalAnswers,shared:ProgramTemplate[],data:AppSnapshot):Promise<GoalPreview> {
  validateTrainingPreferences(trainingPreferences(a));
  validateSelection(a.programSelection);
  let p:Program,reasons:string[];
  if(a.restrictions==='keep-current') {
    const current=data.programs.find(p=>p.id===data.activeProgramId);
    if(!current?.workouts.length || !selectionEqual(a.programSelection,await currentSelection(current))) throw new Error('Your current program changed. Review it again before creating the goal.');
    p=copy(current);reasons=['Retaining the program you identified as individually suitable; no new suitability assessment is inferred.'];
  } else {
    const report=await recommendPrograms(trainingPreferences(a),shared,data.programs);
    const match=report.matches.find(m=>selectionEqual(m.selection,a.programSelection));
    if(!match) throw new Error('The selected plan changed or no longer matches your answers. Reload the recommendations and preview again.');
    p=copy(match.program);reasons=[...match.reasons,...match.differences,report.policy,'Eligible alternatives were compared; no split is universally best.'];
  }
  // Retain only program fields when the source is a template.
  const program:Program={id:p.id,name:p.name,level:p.level,goal:a.goal,workouts:copy(p.workouts),...(p.source?{source:p.source}:{}),...(p.sourceName?{sourceName:p.sourceName}:{}),...(p.sourceReviewedAt?{sourceReviewedAt:p.sourceReviewedAt}:{}),...(p.adaptationNote?{adaptationNote:p.adaptationNote}:{}),...(p.details?{details:copy(p.details)}:{})};
  return {version:EXPERT_GOAL_VERSION,program,targets:calculateNutritionTargets(a.nutrition,'goal-target-preview'),rationale:[...reasons,...nutritionGuidance(a,p)],selection:copy(a.programSelection!),expertVersion:policy.version};
}

import { id } from './domain';
import type { AppSnapshot, Exercise, Muscle, Program, ProgramDocument, ProgramMetadata, ProgramTemplate } from './domain';

export const PROGRAM_FORMAT = 'bodybuilder.program.v1' as const;
export const MAX_PROGRAM_TEXT = 128 * 1024;
// Program data is JSON; serializing also unwraps Svelte reactive proxies.
function copyJSON<T>(value:T):T { return JSON.parse(JSON.stringify(value)) as T; }
const fields = ['key','version','name','description','experience','goals','equipment','daysPerWeek','sessionMinutes','focus','purpose','reviewedAt','notes','progression','nutrition','evidence'];
function object(value: unknown, allowed: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const field of Object.keys(value)) if (!allowed.includes(field)) throw new Error(`${label}: unsupported field ${field}.`);
}
function text(value: unknown, label: string, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`${label} is missing or too long.`);
}
function key(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,79}$/.test(value)) throw new Error(`${label} must be 2–80 lowercase letters, digits or hyphens, starting with a letter.`);
}
function number(value: unknown, label: string, min: number, max: number, integer = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new Error(`${label} must be ${min}–${max}${integer ? ' (whole number)' : ''}.`);
}
function choice(value: unknown, allowed: unknown[], label: string): void { if (!allowed.includes(value)) throw new Error(`Choose a supported ${label}.`); }
function choices(value: unknown, allowed: string[], label: string): void {
  if (!Array.isArray(value) || !value.length || value.length > allowed.length || new Set(value).size !== value.length) throw new Error(`${label} must contain unique supported values.`);
  value.forEach(v=>choice(v,allowed,label));
}

/** Strict JSON only: prose, executable code and unknown fields never become saved records. */
export function validateProgramDocument(input: unknown, known: Set<string>): asserts input is ProgramDocument {
  object(input,[...fields,'schemaVersion','workouts'],'Program');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength>MAX_PROGRAM_TEXT) throw new Error('Program document must be under 128 KiB.');
  choice(input.schemaVersion,[PROGRAM_FORMAT],'schemaVersion'); key(input.key,'Program key');
  number(input.version,'Version',1,1_000_000,true); text(input.name,'Program name',150); text(input.description,'Description',2000);
  choices(input.experience,['beginner','intermediate','advanced'],'Experience'); choices(input.goals,['build-muscle','maintain','lose-fat'],'Goals');
  choice(input.equipment,['full-gym','dumbbells'],'equipment'); choice(input.focus,['balanced','glutes'],'focus'); choice(input.purpose,['hypertrophy','strength','general'],'purpose');
  number(input.daysPerWeek,'Days per week',1,7,true); number(input.sessionMinutes,'Session minutes',15,180,true);
  text(input.reviewedAt,'Reviewed date',10);
  const reviewed=new Date(`${input.reviewedAt}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedAt) || !Number.isFinite(reviewed.getTime()) || reviewed.toISOString().slice(0,10)!==input.reviewedAt) throw new Error('Use a real reviewed date (YYYY-MM-DD).');
  text(input.notes,'Plan notes',2000);
  object(input.progression,['method','instructions','stall'],'Progression'); choice(input.progression.method,['double-progression','linear-progression','manual'],'progression method');
  text(input.progression.instructions,'Progression instructions',3000); text(input.progression.stall,'Stall guidance',3000);
  object(input.nutrition,['proteinPerKg','fatPercent','instructions'],'Nutrition');
  number(input.nutrition.proteinPerKg,'Protein per kg',1,2.5); number(input.nutrition.fatPercent,'Fat percentage',20,35); text(input.nutrition.instructions,'Nutrition instructions',3000);
  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 10) throw new Error('Add 1–10 evidence links.');
  for (const item of input.evidence) {
    object(item,['title','url'],'Evidence'); text(item.title,'Evidence title',200); text(item.url,'Evidence URL',2000);
    let url: URL; try { url=new URL(item.url); } catch { throw new Error('Evidence links must be HTTPS URLs.'); }
    if (url.protocol!=='https:' || !url.hostname || url.username || url.password) throw new Error('Evidence links must be HTTPS URLs.');
  }
  if (!Array.isArray(input.workouts) || input.workouts.length !== input.daysPerWeek) throw new Error('Provide one distinct workout for each training day.');
  const workoutKeys=new Set<string>();
  for (const raw of input.workouts) {
    object(raw,['key','name','warmup','exercises'],'Workout'); key(raw.key,'Workout key'); text(raw.name,'Workout name',150);
    if (workoutKeys.has(raw.key as string)) throw new Error('Workout keys must be unique.'); workoutKeys.add(raw.key as string);
    if (!Array.isArray(raw.warmup) || raw.warmup.length<1 || raw.warmup.length>10) throw new Error('Each workout needs 1–10 warmup instructions.');
    raw.warmup.forEach(v=>text(v,'Warmup instruction',1000));
    if (!Array.isArray(raw.exercises) || raw.exercises.length<1 || raw.exercises.length>20) throw new Error('Each workout needs 1–20 exercises.');
    const prescriptionKeys=new Set<string>();
    for (const rx of raw.exercises) {
      object(rx,['key','exerciseId','sets','repsMin','repsMax','restSeconds','perSide','seconds','amrapLast','superset'],'Exercise'); key(rx.key,'Exercise key');
      if (prescriptionKeys.has(rx.key as string)) throw new Error('Exercise keys must be unique within each workout.'); prescriptionKeys.add(rx.key as string);
      if (typeof rx.exerciseId!=='string' || !known.has(rx.exerciseId)) throw new Error(`Unknown exercise ID: ${String(rx.exerciseId)}. Use the exercise reference.`);
      number(rx.sets,'Sets',1,10,true); number(rx.repsMin,'Minimum reps/seconds',1,600,true); number(rx.repsMax,'Maximum reps/seconds',1,600,true);
      if ((rx.repsMin as number)>(rx.repsMax as number)) throw new Error('Minimum reps/seconds must not exceed maximum.');
      number(rx.restSeconds,'Rest seconds',0,600,true);
      for (const field of ['perSide','seconds','amrapLast']) if (rx[field]!==undefined && typeof rx[field]!=='boolean') throw new Error(`${field} must be true or false.`);
      if (rx.seconds && rx.amrapLast) throw new Error('Timed holds cannot have an AMRAP set.');
      if (rx.superset!==undefined) key(rx.superset,'Superset key');
    }
  }
}

export function parseProgramText(source: string, known: Set<string>): ProgramDocument {
  if (new TextEncoder().encode(source).byteLength>MAX_PROGRAM_TEXT) throw new Error('Program text must be under 128 KiB.');
  const trimmed=source.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1');
  let input: unknown; try { input=JSON.parse(trimmed); } catch { throw new Error('Paste one complete JSON program document. Check commas and quotation marks.'); }
  validateProgramDocument(input,known); return copyJSON(input);
}
export function programFromDocument(doc: ProgramDocument, exercises: Exercise[], muscles: Muscle[], makeId: (prefix: string)=>string = id, existing?: Program): Program {
  validateProgramDocument(doc,new Set(exercises.map(e=>e.id)));
  const {schemaVersion:_,workouts,...metadata}=copyJSON(doc);
  return {id:existing?.id ?? makeId('program'),name:doc.name,level:doc.experience.map(s=>s[0].toUpperCase()+s.slice(1)).join(' / '),goal:doc.goals[0],
    source:doc.evidence[0].url,sourceName:'Program evidence',sourceReviewedAt:doc.reviewedAt,adaptationNote:doc.notes,details:metadata,
    workouts:workouts.map(w=>{
      const old=existing?.workouts.find(x=>x.key===w.key);
      const muscleIds=new Set(w.exercises.flatMap(r=>exercises.find(e=>e.id===r.exerciseId)!.muscles));
      return {id:old?.id ?? makeId('workout'),key:w.key,name:w.name,warmup:w.warmup,muscles:muscles.filter(m=>muscleIds.has(m.id)),
        exercises:w.exercises.map(r=>({ ...r,id:old?.exercises.find(x=>x.key===r.key)?.id ?? makeId('prescription') }))};
    })};
}
export function templateFromDocument(doc: ProgramDocument, exercises: Exercise[], muscles: Muscle[], revision=0): ProgramTemplate {
  let counter=0;
  const p=programFromDocument(doc,exercises,muscles,prefix=>`${doc.key}-${prefix}-${counter++}`);
  return {...p,id:doc.key,description:doc.description,daysPerWeek:doc.daysPerWeek,equipment:doc.equipment==='full-gym'?'Full gym':'Dumbbells and bench',source:doc.evidence[0].url,revision};
}
function normalizeSuperset(value: string): string { return /^[a-z][a-z0-9-]{1,79}$/.test(value) ? value : `group-${value.toLowerCase().replace(/[^a-z0-9-]/g,'-')}`.slice(0,80); }
export function documentFromProgram(p: Program): ProgramDocument {
  const fallback: ProgramMetadata={key:`personal-${p.id}`.slice(0,80),version:1,name:p.name,description:`Personal program: ${p.name}`,experience:['beginner'],goals:[p.goal],equipment:'full-gym',daysPerWeek:p.workouts.length,sessionMinutes:60,focus:'balanced',purpose:'general',reviewedAt:new Date().toISOString().slice(0,10),notes:p.adaptationNote || 'Personal program. Review exercise selection and training dose to suit your needs.',progression:{method:'manual',instructions:'Progress load and repetitions based on controlled technique and logged performance.',stall:'Keep the load and review technique and recovery when performance stalls.'},nutrition:{proteinPerKg:1.6,fatPercent:25,instructions:'Calculate personal targets in Nutrition Targets. This export does not change calories or macros.'},evidence:[{title:p.sourceName || 'ACSM resistance-training guidance',url:p.source?.startsWith('https://') ? p.source : 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/'}]};
  return {...copyJSON(p.details ?? fallback),schemaVersion:PROGRAM_FORMAT,name:p.name,daysPerWeek:p.workouts.length,
    workouts:p.workouts.map(w=>({key:w.key ?? w.id,name:w.name,warmup:copyJSON(w.warmup),exercises:w.exercises.map(r=>{
      const {id:_,superset,...rx}=r;return {...rx,key:r.key ?? r.id,...(superset?{superset:normalizeSuperset(superset)}:{})};
    })}))};
}
function canonical(value: unknown): string {
  return JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined && x!==false).sort(([a],[b])=>a.localeCompare(b))) : v);
}
export function sameProgramDocument(a: ProgramDocument,b: ProgramDocument): boolean { return canonical(a)===canonical(b); }
export function applyProgramImport(data: AppSnapshot, doc: ProgramDocument, exercises: Exercise[], muscles: Muscle[]): void {
  validateProgramDocument(doc,new Set(exercises.map(e=>e.id)));
  const existing=data.programs.find(p=>p.details?.key===doc.key);
  if (existing) {
    if (sameProgramDocument(documentFromProgram(existing),doc)) { data.activeProgramId=existing.id;return; }
    if (doc.version<=existing.details!.version) throw new Error(`Increase version above ${existing.details!.version} to update this program.`);
    const removed=existing.workouts.filter(w=>!doc.workouts.some(next=>next.key===w.key));
    if (removed.some(w=>data.schedule.some(s=>s.workoutId===w.id) || data.sessions.some(s=>!s.finishedAt && s.workoutId===w.id))) throw new Error('Keep the keys of assigned workouts. Remove their calendar assignments before removing a workout.');
  }
  const program=programFromDocument(doc,exercises,muscles,id,existing);
  const at=data.programs.findIndex(p=>p.id===program.id); if(at<0)data.programs.push(program);else data.programs[at]=program;
  data.activeProgramId=program.id;
}

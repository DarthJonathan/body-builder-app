import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const frontend=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const out=await mkdtemp(path.join(tmpdir(),'bodybuilder-expert-'));
try {
 await promisify(execFile)(process.execPath,[require.resolve('typescript/bin/tsc'),'src/lib/expert.ts','src/lib/progress-review.ts','src/lib/goals.ts','src/lib/mock/client.ts','--outDir',out,'--module','commonjs','--target','ES2022','--resolveJsonModule','--esModuleInterop','--moduleResolution','node','--skipLibCheck','--strict','--lib','ES2022,DOM'],{cwd:frontend,timeout:30000});
 await writeFile(path.join(out,'package.json'),'{"type":"commonjs"}\n');
 const compiled=createRequire(path.join(out,'tests.cjs'));
 const {recommendPrograms,programDigest,previewExpertGoal,currentSelection,trainingPreferences}=compiled('./expert.js');
 const {reviewProgress}=compiled('./progress-review.js');
 const {templates}=compiled('./catalogue.js');
 const {applyGoalCreation,defaultDays,recommendedSplit}=compiled('./goals.js');
 const {createFixture}=compiled('./mock/fixtures.js');
 const {calculateNutritionTargets}=compiled('./nutrition.js');
 const recommendations=JSON.parse(await readFile(new URL('../../docs/fixtures/program-recommendations.json',import.meta.url),'utf8'));
 const progress=JSON.parse(await readFile(new URL('../../docs/fixtures/progress-reviews.json',import.meta.url),'utf8'));
 for(const c of recommendations.cases) await test(`recommendation golden: ${c.name}`,async()=>{
  const report=await recommendPrograms(c.input,templates,[]);
  assert.equal(report.version,recommendations.version);assert.equal(report.matches[0]?.selection.id ?? null,c.topId);
  if(c.topId)assert.equal(report.matches[0].score,c.score);else assert.match(report.explanation,/No library program/);
  for(const m of report.matches) {assert.equal(m.program.workouts.length,c.input.daysPerWeek);assert.ok(m.program.details.sessionMinutes<=c.input.sessionMinutes);}
  assert.equal(report.matches.length+report.excluded.length,templates.length);
 });
 await test('content digests agree with independent canonical document fixtures',async()=>{for(const [id,digest] of Object.entries(recommendations.digests))assert.equal(await programDigest(templates.find(p=>p.id===id)),digest,id);});
 const a={...recommendations.cases[0].input,startDate:'2026-10-10',restrictions:'none',split:'full-body',workoutDays:[0,2,4],nutritionExperience:'new',pace:'gentle',nutrition:{age:30,sex:'male',heightCm:175,weightKg:70,activity:'moderate',goal:'build-muscle',effectiveDate:'2026-10-10',calorieAdjustment:150,proteinPerKg:1.6,fatPercent:25}};
 await test('personal candidates, deterministic ties and selected real prescriptions are preserved',async()=>{
  const data=createFixture('expert@example.test');const personal=structuredClone(templates.find(p=>p.id==='bb-foundation-3'));personal.id='private-foundation';personal.details.key='private-foundation';data.programs.push(personal);
  const report=await recommendPrograms(trainingPreferences(a),templates,data.programs),own=report.matches.find(m=>m.selection.scope==='personal');assert.ok(own);
  const p=await previewExpertGoal({...a,programSelection:own.selection},templates,data);assert.equal(p.program.id,personal.id);assert.deepEqual(p.program.workouts,personal.workouts);
  const before=structuredClone(data);const input={version:p.version,answers:{...a,programSelection:own.selection},targets:{...p.targets,mode:'manual',manuallyOverridden:true,calories:2400},schedulePolicy:'replace-upcoming'};
  applyGoalCreation(data,input,'2026-10-10',p);assert.equal(data.goalPlans.at(-1).answers.programSelection.scope,'personal');assert.equal(data.programs.at(-1).details.key,`copy-${data.activeProgramId}`);assert.equal(data.targets.at(-1).calories,2400);assert.deepEqual(data.foodEntries,before.foodEntries);
  const reordered=await recommendPrograms(trainingPreferences(a),[...templates].reverse(),[personal]);assert.deepEqual(report.matches.map(m=>m.selection),reordered.matches.map(m=>m.selection));
 });
 await test('stale dose, metadata, revision and foreign personal selection require a new preview',async()=>{
  const data=createFixture('stale@example.test'),report=await recommendPrograms(trainingPreferences(a),templates,data.programs),selected=report.matches[0];
  const good={...a,programSelection:selected.selection};assert.equal((await previewExpertGoal(good,templates,data)).version,'goal-library-v2');
  for(const change of [p=>p.workouts[0].exercises[0].sets++,p=>p.details.version++,p=>p.revision=1]) {const changed=structuredClone(templates);change(changed.find(p=>p.id===selected.selection.id));await assert.rejects(previewExpertGoal(good,changed,data),/changed/);}
  const foreign={...selected.program,id:'other-personal'};const ownReport=await recommendPrograms(trainingPreferences(a),[],[foreign]);await assert.rejects(previewExpertGoal({...a,programSelection:ownReport.matches[0].selection},templates,data),/changed/);
  const bad=structuredClone(templates);bad.find(p=>p.id===selected.selection.id).workouts[0].exercises[0].exerciseId='missing';assert.ok(!(await recommendPrograms(trainingPreferences(a),bad,[])).matches.some(m=>m.selection.id===selected.selection.id));
 });
 for(const c of progress.cases)await test(`recorded progress golden: ${c.name}`,()=>{
  const original=structuredClone(c.snapshot),r=reviewProgress(c.snapshot,c.asOf);assert.equal(r.version,progress.version);assert.equal(r.training[0]?.kind ?? '',c.kind);assert.deepEqual(c.snapshot,original);
  if(c.kind==='increase-load')assert.equal(r.training[0].suggestedLoadKg,51.25);
 });
 await test('nutrition trends require coverage, stable targets and respect manual overrides',()=>{
  const data=structuredClone(progress.cases[0].snapshot);data.targets=[calculateNutritionTargets({...a.nutrition,effectiveDate:'2026-09-01'},'nutrition')];
  for(let i=0;i<14;i++){const date=`2026-10-${String(i+1).padStart(2,'0')}`;data.weights.push({id:`w-${i}`,date,weight:70});for(const meal of ['Breakfast','Dinner'])data.foodEntries.push({id:`f-${i}-${meal}`,date,meal,calories:1100});}
  let r=reviewProgress(data,'2026-10-15');assert.equal(r.nutrition.status,'review-trend');assert.equal(r.nutrition.averageLoggedCalories,2200);assert.equal(r.nutrition.weeklyChangeKg,0);
  data.targets[0].mode='manual';r=reviewProgress(data,'2026-10-15');assert.equal(r.nutrition.status,'manual-targets');data.targets[0].mode='calculated';
  data.targets.push({...data.targets[0],id:'new-target',effectiveDate:'2026-10-10'});assert.equal(reviewProgress(data,'2026-10-15').nutrition.status,'insufficient-data');data.targets.pop();
  data.foodEntries=data.foodEntries.filter(f=>f.meal==='Breakfast');assert.equal(reviewProgress(data,'2026-10-15').nutrition.status,'insufficient-data');
  data.weights=[];assert.equal(reviewProgress(data,'2026-10-15').nutrition.weeklyChangeKg,undefined);
 });
} finally {await rm(out,{recursive:true,force:true});}

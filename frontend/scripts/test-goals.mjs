import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const output = await mkdtemp(path.join(tmpdir(), 'bodybuilder-goals-'));
const fixtures = JSON.parse(await readFile(new URL('../../docs/fixtures/goal-plans.json', import.meta.url), 'utf8'));
try {
  await promisify(execFile)(process.execPath, [require.resolve('typescript/bin/tsc'), 'src/lib/goals.ts', 'src/lib/mock/fixtures.ts',
    '--outDir', output, '--module', 'commonjs', '--target', 'ES2022', '--resolveJsonModule', '--esModuleInterop',
    '--moduleResolution', 'node', '--skipLibCheck', '--strict', '--lib', 'ES2022,DOM'], {cwd:frontend,timeout:30_000});
  await writeFile(path.join(output,'package.json'),'{"type":"commonjs"}\n');
  const compiled=createRequire(path.join(output,'tests.cjs'));
  const {GOAL_VERSION,previewGoal,applyGoalCreation,validateGoalCreation,compatibleSplits,defaultDays}=compiled('./goals.js');
  const {sameCalculationProvenance}=compiled('./nutrition.js');
  const {validateHealthEnergy}=compiled('./health.js');
  const {createFixture}=compiled('./mock/fixtures.js');
  const {exercises}=compiled('./catalogue.js');
  const base=structuredClone(fixtures.cases[0].answers);
  const creation = answers => {const p=previewGoal(answers);return {version:GOAL_VERSION,answers,targets:p.targets,schedulePolicy:'replace-upcoming'};};
  const energy = () => ({source:'apple-health',syncedAt:'2026-10-09T04:00:00Z',timezone:'Asia/Singapore',sources:['Test Watch'],days:Array.from({length:7},(_,i)=>({date:`2026-10-${String(i+2).padStart(2,'0')}`,restingCalories:1600,activeCalories:400,coverageHours:24,dayHours:24}))});
  assert.equal(GOAL_VERSION, fixtures.version);
  for(const sample of fixtures.cases) await test(`Go/TypeScript goal golden: ${sample.name}`,()=>{
    const original=structuredClone(sample.answers), p=previewGoal(original);
    assert.deepEqual(p.program.workouts.map(w=>w.exercises.map(e=>e.exerciseId)),sample.expected.exercises);
    for(const w of p.program.workouts) for(const e of w.exercises) assert.equal(e.sets,sample.expected.sets);
    for(const key of ['calories','protein','carbs','fat']) assert.equal(p.targets[key],sample.expected[key],key);
    for(const key of ['restingCalories','maintenanceCalories']) assert.equal(p.targets.calculation[key],sample.expected[key],key);
    assert.deepEqual(original,sample.answers,'a preview must not mutate the answers');
  });
  await test('all frequency, duration and equipment combinations reference usable exercises',()=>{
    for(const equipment of ['full-gym','dumbbells']) for(let days=2;days<=6;days++) for(const split of compatibleSplits(days)) for(const sessionMinutes of [30,45,60]) {
      const p=previewGoal({...structuredClone(base),equipment,daysPerWeek:days,workoutDays:defaultDays(days),split,sessionMinutes,focus:'balanced'});
      assert.equal(p.program.workouts.length,days);
      for(const w of p.program.workouts) {
        assert.ok(w.exercises.length>=4 && w.exercises.length<=(sessionMinutes===30?4:sessionMinutes===45?5:6),'workout fits its exercise/time budget');
        for(const rx of w.exercises) {const exercise=exercises.find(e=>e.id===rx.exerciseId);assert.ok(exercise);if(equipment==='dumbbells')assert.ok(['Dumbbells','Dumbbell or kettlebell','Bodyweight'].includes(exercise.equipment),exercise.name);}
      }
    }
  });
  await test('ambiguous schedules and inconsistent nutrition answers are rejected',()=>{
    for(const change of [{workoutDays:[0,0,4]},{workoutDays:[0,2]},{split:'ppl'},{daysPerWeek:7},{nutrition:{...base.nutrition,goal:'maintain'}},{nutrition:{...base.nutrition,calorieAdjustment:250}},{unknown:true}]) assert.throws(()=>previewGoal({...structuredClone(base),...change}));
    assert.throws(()=>previewGoal({...base,restrictions:'keep-current'}),/existing/);
  });
  await test('Health energy replaces the activity factor and keeps order-independent provenance',()=>{
    const a=structuredClone(base);a.nutrition.healthEnergy=energy();
    const p=previewGoal(a);assert.equal(p.targets.calories,2150);assert.equal(p.targets.calculation.restingCalories,1600);assert.equal(p.targets.calculation.maintenanceCalories,2000);
    const reordered=structuredClone(p.targets.calculation);reordered.input.healthEnergy={days:reordered.input.healthEnergy.days.map(d=>({dayHours:d.dayHours,coverageHours:d.coverageHours,activeCalories:d.activeCalories,restingCalories:d.restingCalories,date:d.date})),sources:['Test Watch'],timezone:'Asia/Singapore',syncedAt:energy().syncedAt,source:'apple-health'};
    assert.ok(sameCalculationProvenance(reordered,p.targets.calculation));
    reordered.input.healthEnergy.days[0].activeCalories=0;assert.equal(sameCalculationProvenance(reordered,p.targets.calculation),false);
  });
  await test('partial, overlapping-date, unsupported and current-day Health summaries fail',()=>{
    for(const change of [h=>h.days.pop(),h=>delete h.days[0].activeCalories,h=>h.days[0].coverageHours=10,h=>h.days[0].date=h.days[1].date,h=>h.days[6].date='2026-10-09',h=>h.days[0].unsupported=10,h=>h.timezone='Unknown/Zone',h=>h.days[0].restingCalories=Infinity]) {const h=energy();change(h);assert.throws(()=>validateHealthEnergy(h));}
    const h=energy();h.days[0].activeCalories=0;assert.doesNotThrow(()=>validateHealthEnergy(h),'an explicit zero differs from missing data');
  });
  await test('manual targets retain the current preview; stale or fabricated provenance fails',()=>{
    const input=creation(structuredClone(base));input.targets={...input.targets,calories:2300,protein:130,carbs:280,fat:65,mode:'manual',manuallyOverridden:true};
    assert.doesNotThrow(()=>validateGoalCreation(input));
    input.answers.nutrition.weightKg=72;assert.throws(()=>validateGoalCreation(input),/Preview/);
    input.answers.nutrition.weightKg=70;input.targets.calculation.version='apple-health-energy-v1';assert.throws(()=>validateGoalCreation(input));
  });
  await test('atomic mock creation protects logged sessions and retains existing food and programs',()=>{
    const state=createFixture('goal-tests@example.test','Goal Tester');const today='2026-10-09';
    const histories=structuredClone({sessions:state.sessions,foods:state.foodEntries,old:state.programs});
    const protectedDate=state.sessions.find(s=>s.date>=today)?.date ?? today;
    if(!state.sessions.some(s=>s.date===protectedDate)) state.sessions.push({...structuredClone(state.sessions[0]),id:'protected-session',date:protectedDate});
    const protectedEntry=structuredClone(state.schedule.find(s=>s.date===protectedDate));
    const input=creation(structuredClone(base));applyGoalCreation(state,input,today);
    assert.equal(state.goalPlans.length,1);assert.equal(state.goalPlans[0].version,GOAL_VERSION);
    assert.deepEqual(state.foodEntries,histories.foods);assert.deepEqual(state.programs.slice(0,-1),histories.old);
    for(const session of histories.sessions) assert.deepEqual(state.sessions.find(s=>s.id===session.id),session);
    assert.deepEqual(state.schedule.find(s=>s.date===protectedDate),protectedEntry);
    const saved=state.goalPlans[0];input.answers.workoutDays[0]=1;assert.equal(saved.answers.workoutDays[0],0,'history owns its answer copy');
    assert.ok(!state.programs.at(-1).id.includes('preview'));assert.equal(state.profile.startWeight,70);
  });
  await test('keeping current workouts leaves prescriptions untouched; invalid dates never mutate',()=>{
    const state=createFixture('keep-tests@example.test','Keep Tester');const current=state.programs.find(p=>p.id===state.activeProgramId);
    const answers={...structuredClone(base),restrictions:'keep-current'};const p=previewGoal(answers,current);
    assert.deepEqual(p.program,current);
    const input={version:GOAL_VERSION,answers,targets:p.targets,schedulePolicy:'keep-existing'};
    const before=structuredClone(state);input.answers.startDate='2026-10-08';input.answers.nutrition.effectiveDate='2026-10-08';input.targets=previewGoal(answers,current).targets;
    assert.throws(()=>applyGoalCreation(state,input,'2026-10-09'),/today/);assert.deepEqual(state,before);
  });
} finally {await rm(output,{recursive:true,force:true});}

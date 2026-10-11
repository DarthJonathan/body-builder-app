import { test,expect,snapshot,navigate,assertNoHorizontalOverflow } from './helpers';
import { openGoal,nextGoalQuestion,reachGoalEnergy,reachGoalTargets,finishGoal } from './goal-helpers';
import { readFileSync } from 'node:fs';
const progressFixtures=JSON.parse(readFileSync(new URL('../../docs/fixtures/progress-reviews.json',import.meta.url),'utf8'));

async function trainingQuestions(app:import('@playwright/test').Page){
 await openGoal(app);await app.getByRole('button',{name:'Let’s do it!',exact:true}).click();await nextGoalQuestion(app);
}
test('ranked strength preference can be overridden with an eligible muscle plan',async({app},testInfo)=>{
 await trainingQuestions(app);const wizard=app.getByRole('main',{name:'Create a goal plan'});
 await wizard.getByRole('button',{name:'Previous question',exact:true}).click();await wizard.getByRole('radio',{name:/^Intermediate/}).check();await nextGoalQuestion(app);
 await wizard.getByRole('button',{name:'4',exact:true}).click();await wizard.getByRole('button',{name:'60 min',exact:true}).click();await wizard.getByLabel('Training priority',{exact:true}).selectOption('strength');await nextGoalQuestion(app);
 await expect(wizard.getByRole('heading',{name:'Recommended Programs'})).toBeVisible();
 await expect(wizard.getByRole('radio',{name:'4-Day Strength & Muscle',exact:true})).toBeChecked();
 await wizard.getByRole('radio',{name:'4-Day Upper / Lower Muscle',exact:true}).check();
 await expect(wizard.getByRole('region',{name:'Selected program explanation'})).toContainText('hypertrophy emphasis rather than your strength priority');
 await assertNoHorizontalOverflow(app);await testInfo.attach('ranked-programs',{body:await app.screenshot(),contentType:'image/png'});
 await nextGoalQuestion(app);await reachGoalEnergy(app);await reachGoalTargets(app);await finishGoal(app);
 const state=await snapshot(app),plan=state.goalPlans!.at(-1)!;expect(plan.version).toBe('goal-library-v2');expect(plan.answers.programSelection?.id).toBe('bb-upper-lower-4');expect(plan.answers.trainingPriority).toBe('strength');
 expect(state.programs.at(-1)?.details?.purpose).toBe('hypertrophy');expect(state.programs.at(-1)?.workouts).toHaveLength(4);
});
test('no match explains constraints and cannot create an invented plan',async({app})=>{
 const before=await snapshot(app);await trainingQuestions(app);const wizard=app.getByRole('main',{name:'Create a goal plan'});
 await wizard.getByRole('button',{name:'6',exact:true}).click();await wizard.getByRole('button',{name:'30 min',exact:true}).click();await nextGoalQuestion(app);
 await expect(wizard).toContainText('No library program meets all of these constraints');await nextGoalQuestion(app);await expect(wizard.getByRole('alert')).toContainText('No eligible plan');expect(await snapshot(app)).toEqual(before);
 await wizard.getByRole('button',{name:'Previous question',exact:true}).click();await wizard.getByRole('button',{name:'2',exact:true}).click();await wizard.getByRole('radio',{name:/Dumbbells & Bench/}).check();await nextGoalQuestion(app);
 await expect(wizard.getByRole('radio',{name:'2-Day Quick Dumbbell Foundation',exact:true})).toBeChecked();
});
test('progress suggestions show logged evidence and open editable controls without changing records',async({app})=>{
 const sample=progressFixtures.cases[0].snapshot;
 await app.evaluate(sample=>{
  const email=localStorage.getItem('bodybuilder.preview.active')!,key=`bodybuilder.preview.account.v1:${encodeURIComponent(email)}`,saved=JSON.parse(localStorage.getItem(key)!);
  saved.snapshot.programs=sample.programs;saved.snapshot.activeProgramId=sample.activeProgramId;saved.snapshot.sessions=sample.sessions;saved.snapshot.schedule=[];
  localStorage.setItem(key,JSON.stringify(saved));
 },sample);
 await app.reload();await navigate(app,'progress');const before=await snapshot(app);
 await app.getByRole('button',{name:'Review My Progress',exact:true}).click();const dialog=app.getByRole('dialog');await expect(dialog).toContainText('Consider a load increase');await expect(dialog).toContainText('51.25 kg');await expect(dialog).toContainText('two separate sessions');await assertNoHorizontalOverflow(app);expect(await snapshot(app)).toEqual(before);
 await dialog.getByRole('button',{name:'Review Workout',exact:true}).click();await expect(app.getByRole('button',{name:'Start Workout',exact:true})).toBeVisible();expect(await snapshot(app)).toEqual(before);
 await app.getByRole('button',{name:'Back to workouts',exact:true}).click();await app.getByRole('button',{name:'Review My Progress',exact:true}).click();await app.getByRole('dialog').getByRole('button',{name:'Review Nutrition Targets',exact:true}).click();await expect(app.getByRole('dialog').getByLabel('Calories',{exact:true})).toBeVisible();expect(await snapshot(app)).toEqual(before);
});

import { test,expect,registerAccount,backendSnapshot,signIn,navigate,addManualFood } from './helpers';
import { reachGoalSchedule,reachGoalEnergy,reachGoalTargets,finishGoal } from '../goal-helpers';

test('one real goal mutation creates a private program, schedule and nutrition targets on both devices',async({app,secondDevice},testInfo)=>{
  const account=await registerAccount(app,testInfo,'goal');
  await addManualFood(app,'Food retained while creating a goal');
  const before=await backendSnapshot(app,account.token);
  const requests:string[]=[];
  app.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/mutations')requests.push(request.postDataJSON()?.operation);});
  await reachGoalSchedule(app);await reachGoalEnergy(app);await reachGoalTargets(app);
  expect((await backendSnapshot(app,account.token)).revision).toBe(before.revision);
  await finishGoal(app);
  const saved=await backendSnapshot(app,account.token),plan=saved.goalPlans![0];
  expect(requests).toEqual(['createGoalPlan']);expect(saved.revision).toBe(before.revision+1);
  expect(saved.programs).toHaveLength(1);expect(saved.schedule).toHaveLength(28);expect(saved.targets).toHaveLength(1);
  expect(plan.version).toBe('goal-library-v2');expect(plan.answers.programSelection?.id).toBe('bb-foundation-3');expect(saved.programs[0].details?.daysPerWeek).toBe(3);
  expect(plan.programId).toBe(saved.activeProgramId);expect(plan.targets.calories).toBe(2710);expect(saved.foodEntries).toEqual(before.foodEntries);
  await signIn(secondDevice,account);await navigate(secondDevice,'Progress');
  await secondDevice.getByRole('button',{name:'View Goal Plan & Research',exact:true}).click();
  await expect(secondDevice.getByRole('dialog')).toContainText('3-Day Full Body');
  await secondDevice.getByRole('button',{name:'Close dialog',exact:true}).click();await navigate(secondDevice,'Nutrition');
  await secondDevice.getByRole('button',{name:'Nutrition settings',exact:true}).click();
  await expect(secondDevice.getByRole('dialog').getByLabel('Calories',{exact:true})).toHaveValue('2710');
  await secondDevice.getByRole('button',{name:'Close dialog',exact:true}).click();await navigate(secondDevice,'Progress');
  const beforeReview=await backendSnapshot(secondDevice,account.token);
  await secondDevice.getByRole('button',{name:'Review My Progress',exact:true}).click();await expect(secondDevice.getByRole('dialog')).toContainText('Log complete working sets');expect(await backendSnapshot(secondDevice,account.token)).toEqual(beforeReview);
  await app.reload();expect((await backendSnapshot(app,account.token)).goalPlans).toEqual(saved.goalPlans);
});

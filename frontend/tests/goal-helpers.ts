import { expect, type Page } from '@playwright/test';

export async function openGoal(page: Page): Promise<void> {
  await page.getByRole('button', {name:'Progress',exact:true}).click();
  await page.getByRole('button', {name:'Change',exact:true}).click();
  await expect(page.getByRole('main', {name:'Create a goal plan'})).toBeVisible();
}

export async function nextGoalQuestion(page: Page): Promise<void> {
  const wizard=page.getByRole('main',{name:'Create a goal plan'});
  await wizard.getByRole('button',{name:'Continue',exact:true}).click();
}

export async function reachGoalPreferences(page: Page): Promise<void> {
  await openGoal(page);
  const wizard=page.getByRole('main',{name:'Create a goal plan'});
  await wizard.getByRole('radio',{name:/^Build Muscle/}).check();
  await wizard.getByRole('button',{name:'Let’s do it!',exact:true}).click();
  await wizard.getByRole('radio',{name:/^Beginner/}).check();
  await nextGoalQuestion(page);
  await wizard.getByRole('button',{name:'3',exact:true}).click();
  await wizard.getByRole('button',{name:'45 min',exact:true}).click();
}

export async function reachGoalSchedule(page: Page): Promise<void> {
  await reachGoalPreferences(page);
  const wizard=page.getByRole('main',{name:'Create a goal plan'});
  await nextGoalQuestion(page);
  await expect(wizard.getByRole('heading',{name:'Recommended Programs'})).toBeVisible();
  await nextGoalQuestion(page);
  await expect(wizard.getByRole('heading',{name:'Ready?',exact:true})).toBeVisible();
}

export async function reachGoalEnergy(page: Page): Promise<void> {
  await nextGoalQuestion(page); // nutrition experience
  await nextGoalQuestion(page); // body inputs
  const wizard=page.getByRole('main',{name:'Create a goal plan'});
  await expect(wizard.getByRole('heading',{name:'Your starting body stats.'})).toBeVisible();
  await wizard.getByLabel('Age',{exact:true}).fill('30');
  await wizard.getByLabel('Equation sex',{exact:true}).selectOption('male');
  await wizard.getByLabel('Height (cm)',{exact:true}).fill('175');
  await wizard.getByLabel('Weight (kg)',{exact:true}).fill('70');
  await wizard.getByLabel('Usual activity, including exercise',{exact:true}).selectOption('moderate');
  await nextGoalQuestion(page);
  await expect(wizard.getByRole('heading',{name:'Your starting energy estimate.'})).toBeVisible();
}

export async function reachGoalTargets(page: Page): Promise<void> {
  await nextGoalQuestion(page); // pace
  await nextGoalQuestion(page); // asynchronous authoritative/local preview
  const wizard=page.getByRole('main',{name:'Create a goal plan'});
  await expect(wizard.getByRole('heading',{name:/Your personal approach/})).toBeVisible();
  await wizard.getByRole('button',{name:'See Nutrition Targets',exact:true}).click();
  await expect(wizard.getByRole('heading',{name:/nutrition targets/})).toBeVisible();
}

export async function finishGoal(page: Page): Promise<void> {
  await nextGoalQuestion(page);
  await page.getByRole('main',{name:'Create a goal plan'}).getByRole('button',{name:'Create Goal Plan',exact:true}).click();
  await expect(page.getByRole('main',{name:'Create a goal plan'})).not.toBeVisible();
}

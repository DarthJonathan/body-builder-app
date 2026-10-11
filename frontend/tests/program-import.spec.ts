import { readFileSync } from 'node:fs';
import { test, expect, navigate, snapshot, TODAY, assertNoHorizontalOverflow } from './helpers';
import type { ProgramDocument } from '../src/lib/domain';
const examples:ProgramDocument[]=JSON.parse(readFileSync(new URL('../src/lib/program-library.json',import.meta.url),'utf8'));

async function openImport(app:import('@playwright/test').Page) {
 await navigate(app,'workout');await app.getByRole('button',{name:'Import / Export',exact:true}).click();
 await expect(app.getByRole('dialog').getByLabel('Program JSON')).toBeVisible();
}

test('JSON preview, private create/update/export and duplicate import preserve the calendar',async({app},testInfo)=>{
 const before=await snapshot(app);await openImport(app);let dialog=app.getByRole('dialog');
 const doc=structuredClone(examples[0]);doc.key='ui-personal';doc.name='My Imported Foundation';
 await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc,null,2));
 await expect(dialog.getByRole('button',{name:'Import My Program',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:doc.name,exact:true})).toBeVisible();await expect(dialog).toContainText('Nutrition guidance');
 await assertNoHorizontalOverflow(app);
 await dialog.getByRole('button',{name:'Import My Program',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Program saved');
 let state=await snapshot(app);const imported=state.programs.find(p=>p.details?.key===doc.key)!;expect(state.schedule).toEqual(before.schedule);expect(state.targets).toEqual(before.targets);
 const downloadPromise=app.waitForEvent('download');await dialog.getByRole('button',{name:'Download JSON',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('ui-personal.json');
 await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await dialog.getByRole('button',{name:'Update My Program',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Program saved');expect((await snapshot(app)).programs.length).toBe(state.programs.length);
 await app.getByRole('button',{name:'Close dialog',exact:true}).click();await app.getByRole('button',{name:'Options for Fri workout',exact:true}).click();await app.getByRole('dialog').getByRole('button',{name:doc.workouts[0].name,exact:true}).click();await expect(app.getByRole('dialog')).not.toBeVisible();
 const schedule=(await snapshot(app)).schedule;const history=(await snapshot(app)).sessions;
 await openImport(app);dialog=app.getByRole('dialog');doc.name='My revised Foundation';doc.workouts[0].exercises[0].sets++;
 await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Increase version');await expect(dialog.getByRole('button',{name:'Update My Program',exact:true})).toBeDisabled();
 doc.version=2;await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await dialog.getByRole('button',{name:'Update My Program',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Program saved');
 state=await snapshot(app);const updated=state.programs.find(p=>p.id===imported.id)!;expect(updated.workouts[0].id).toBe(imported.workouts[0].id);expect(updated.workouts[0].exercises[0].id).toBe(imported.workouts[0].exercises[0].id);expect(state.schedule).toEqual(schedule);expect(state.sessions).toEqual(history);
 await testInfo.attach('program-import-preview',{body:await app.screenshot({animations:'disabled'}),contentType:'image/png'});
 await app.reload();await navigate(app,'workout');await expect(app.getByText(doc.name,{exact:true})).toBeVisible();expect((await snapshot(app)).programs.find(p=>p.id===imported.id)).toEqual(updated);
 expect((await snapshot(app)).schedule.find(s=>s.date===TODAY)?.workoutId).toBe(imported.workouts[0].id);
});

test('JSON uploads validate before saving and malformed or unknown exercises leave records intact',async({app})=>{
 const before=await snapshot(app);await openImport(app);const dialog=app.getByRole('dialog');
 await dialog.getByLabel('Program JSON').fill('a nice training plan');await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('JSON');
 const doc=structuredClone(examples[0]);doc.workouts[0].exercises[0].exerciseId='unknown';await dialog.getByLabel('Upload JSON').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
 await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Unknown exercise ID');expect(await snapshot(app)).toEqual(before);
 await dialog.getByLabel('Load a plan or export your program').selectOption(examples[9].key);await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await expect(dialog.getByRole('heading',{name:examples[9].name,exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Import My Program',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Program saved');
});

test('administrators publish templates; members see the library and have only personal imports',async({app})=>{
 await openImport(app);let dialog=app.getByRole('dialog');const doc=structuredClone(examples[0]);doc.key='ui-shared-library';doc.name='Shared Library Foundation';
 await dialog.getByLabel('Save to', {exact:true}).selectOption('shared');await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await dialog.getByRole('button',{name:'Publish Shared Plan',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Shared plan published');
 await app.getByRole('button',{name:'Close dialog',exact:true}).click();await app.getByRole('button',{name:'Account information',exact:true}).click();await app.getByLabel('Switch preview account',{exact:true}).fill('member-library@example.test');await app.getByRole('button',{name:'Switch Account',exact:true}).click();
 await navigate(app,'workout');await app.getByRole('button',{name:'Choose a Program',exact:true}).click();dialog=app.getByRole('dialog');const card=dialog.locator('article').filter({has:app.getByRole('heading',{name:doc.name,exact:true})});await expect(card).toBeVisible();await card.getByRole('button',{name:'Preview Plan',exact:true}).click();await expect(dialog).toContainText('Progression');await dialog.getByRole('button',{name:'Export Plan JSON',exact:true}).click();await expect(dialog.getByLabel('Save to',{exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Publish Shared Plan',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await dialog.getByRole('button',{name:'Import My Program',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Program saved');expect((await snapshot(app)).programs.some(p=>p.details?.key===doc.key)).toBe(true);
});

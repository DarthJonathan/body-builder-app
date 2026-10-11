import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect, registerAccount, signIn, backendSnapshot, navigate, signOut } from './helpers';
import type { ProgramDocument } from '../../src/lib/domain';
const plans:ProgramDocument[]=JSON.parse(readFileSync(new URL('../../src/lib/program-library.json',import.meta.url),'utf8'));

async function openImport(page:import('@playwright/test').Page) {
 await navigate(page,'Workout');await page.getByRole('button',{name:'Import / Export',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Program JSON')).toBeVisible();
}

test('real personal JSON upserts retain IDs and sync to a second device',async({app,secondDevice},testInfo)=>{
 const account=await registerAccount(app,testInfo,'program-import');const doc=structuredClone(plans[0]);doc.key='live-personal-'+randomUUID();
 await openImport(app);let dialog=app.getByRole('dialog');await expect(dialog.getByLabel('Save to',{exact:true})).toHaveCount(0);
 await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();
 const save=app.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/mutations' && r.request().method()==='POST');await dialog.getByRole('button',{name:'Import My Program',exact:true}).click();expect((await save).status()).toBe(200);await expect(dialog.getByRole('status')).toContainText('Program saved');
 const before=await backendSnapshot(app,account.token);const p=before.programs[0];expect(before.schedule).toEqual([]);expect(before.targets).toEqual([]);
 doc.version=2;doc.name='Revised live program';doc.workouts[0].exercises[0].sets++;await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await dialog.getByRole('button',{name:'Update My Program',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Program saved');
 const state=await backendSnapshot(app,account.token);expect(state.programs).toHaveLength(1);expect(state.programs[0].id).toBe(p.id);expect(state.programs[0].workouts[0].id).toBe(p.workouts[0].id);expect(state.programs[0].workouts[0].exercises[0].id).toBe(p.workouts[0].exercises[0].id);
 await signIn(secondDevice,account);await navigate(secondDevice,'Workout');await expect(secondDevice.getByText(doc.name,{exact:true})).toBeVisible();expect((await backendSnapshot(secondDevice,account.token)).programs).toEqual(state.programs);
 await signOut(secondDevice);const other=await registerAccount(secondDevice,testInfo,'other-import');expect((await backendSnapshot(secondDevice,other.token)).programs).toEqual([]);
});

test('real administrator publishes shared JSON which members can copy after reload',async({app,secondDevice},testInfo)=>{
 const token=await signIn(app,{email:process.env.E2E_ADMIN_EMAIL!,password:process.env.E2E_ADMIN_PASSWORD!});const doc=structuredClone(plans[0]);doc.key='live-shared-'+randomUUID();doc.name='Shared live '+testInfo.project.name;
 await app.getByRole('button',{name:'Account information',exact:true}).click();await app.getByRole('button',{name:'Manage Program Library',exact:true}).click();const dialog=app.getByRole('dialog');
 await dialog.getByLabel('Save to',{exact:true}).selectOption('shared');await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();
 const publish=app.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/admin/programs' && r.request().method()==='PUT');await dialog.getByRole('button',{name:'Publish Shared Plan',exact:true}).click();expect((await publish).status()).toBe(200);await expect(dialog.getByRole('status')).toContainText('Shared plan published');
 const member=await registerAccount(secondDevice,testInfo,'library-member');await navigate(secondDevice,'Workout');await secondDevice.getByRole('button',{name:'Choose a Program',exact:true}).click();const memberDialog=secondDevice.getByRole('dialog');const card=memberDialog.locator('article').filter({has:secondDevice.getByRole('heading',{name:doc.name,exact:true})});await expect(card).toBeVisible();await card.getByRole('button',{name:'Use Program',exact:true}).click();await expect(memberDialog).not.toBeVisible();const copy=(await backendSnapshot(secondDevice,member.token)).programs[0];expect(copy.id).not.toBe(doc.key);expect(copy.details?.key).not.toBe(doc.key);
 doc.version=2;doc.name+=' revised';await dialog.getByLabel('Program JSON').fill(JSON.stringify(doc));await dialog.getByRole('button',{name:'Validate & Preview',exact:true}).click();await dialog.getByRole('button',{name:'Publish Shared Plan',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Shared plan published');
 expect((await backendSnapshot(secondDevice,member.token)).programs[0]).toEqual(copy);
 const response=await secondDevice.request.put(new URL('/api/v1/admin/programs',secondDevice.url()).toString(),{headers:{authorization:`Bearer ${member.token}`},data:{document:doc,baseRevision:2}});expect(response.status()).toBe(403);
 await app.reload();const library=await app.request.get(new URL('/api/v1/programs/templates',app.url()).toString(),{headers:{authorization:`Bearer ${token}`}});expect(library.status()).toBe(200);expect((await library.json()).data.find((p:{id:string})=>p.id===doc.key).name).toBe(doc.name);
});

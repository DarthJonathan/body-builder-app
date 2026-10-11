import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const output = await mkdtemp(path.join(tmpdir(), 'bodybuilder-mock-api-'));
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

class PreviewStorage {
  records = new Map();
  rejectWrites = false;
  getItem(key) { return this.records.get(key) ?? null; }
  setItem(key, value) {
    if (this.rejectWrites) throw new Error('Simulated unavailable storage');
    this.records.set(key, String(value));
  }
  removeItem(key) { this.records.delete(key); }
}

try {
  await promisify(execFile)(process.execPath, [
    require.resolve('typescript/bin/tsc'), 'src/lib/mock/client.ts',
    '--outDir', output, '--module', 'commonjs', '--target', 'ES2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop', '--resolveJsonModule',
    '--strict', '--lib', 'ES2022,DOM'
  ], { cwd: frontend, timeout: 30_000 });
  await writeFile(path.join(output, 'package.json'), '{"type":"commonjs"}\n');
  const compiled = createRequire(path.join(output, 'tests.cjs'));
  const { createMockClient } = compiled('./mock/client.js');
  const { localDate, shiftDate } = compiled('./domain.js');
  const { templates, exercises, muscles, readings } = compiled('./catalogue.js');
  const { parseProgramText, validateProgramDocument, documentFromProgram, sameProgramDocument } = compiled('./program-documents.js');
  const documents = JSON.parse(await readFile(path.join(frontend,'src/lib/program-library.json'),'utf8'));
  const knownExercises = new Set(exercises.map(e=>e.id));
  const { DEFAULT_PREVIEW_EMAIL, FAIL_NEXT_KEY, DELAY_KEY, ACTIVE_KEY, accountKey } = compiled('./mock/storage.js');
  const today = localDate();

  function setup() {
    const storage = new PreviewStorage();
    storage.setItem(DELAY_KEY, '0');
    globalThis.window = { localStorage: storage };
    return { client: createMockClient(), storage };
  }

  async function rejects(request, status, code) {
    await assert.rejects(request, error => error.name === 'MockApiError' && error.status === status && (!code || error.code === code));
  }


  await test('generated plans validate, round-trip and preserve their scientific provenance', async () => {
    assert.equal(documents.length,10);
    assert.equal(new Set(documents.map(d=>d.key)).size,10);
    assert.equal(templates.length,17);
    for(const doc of documents) {
      validateProgramDocument(doc,knownExercises);
      assert.ok(sameProgramDocument(parseProgramText(JSON.stringify(doc),knownExercises),doc));
      const template=templates.find(t=>t.id===doc.key);
      assert.ok(sameProgramDocument(documentFromProgram(template),doc));
      assert.equal(template.workouts.length,doc.daysPerWeek);
      assert.match(doc.notes,/authored|starting/i);
      if(doc.equipment==='dumbbells') for(const w of template.workouts) for(const rx of w.exercises) assert.ok(['Dumbbells','Dumbbell or kettlebell','Bodyweight'].includes(exercises.find(e=>e.id===rx.exerciseId).equipment));
    }
    // Export the legacy programs too, including uppercase superset group labels.
    for(const template of templates) validateProgramDocument(documentFromProgram(template),knownExercises);
  });

  await test('strict program input rejects unknown IDs, ambiguous keys, fields, nulls and invalid prescriptions', () => {
    const mutations=[d=>d.schemaVersion='future-v2',d=>d.version=1.5,d=>d.reviewedAt='2026-02-30',d=>d.extra='no',d=>d.name='Plan\u0000',d=>d.evidence[0].url='javascript:alert(1)',d=>d.evidence[0].url='https://user:secret@example.com',d=>d.nutrition.fatPercent=40,d=>d.workouts[0].exercises[0].exerciseId='unknown',d=>d.workouts[1].key=d.workouts[0].key,d=>d.workouts[0].exercises[1].key=d.workouts[0].exercises[0].key,d=>d.workouts[0].exercises[0].sets=0,d=>d.workouts[0].exercises[0].repsMin=100,d=>d.workouts[0].exercises[0].restSeconds=null,d=>delete d.workouts[0].exercises[0].restSeconds,d=>d.workouts[0].exercises[0].perSide=null,d=>d.workouts[0].exercises[0].superset='',d=>{d.workouts[0].exercises[0].seconds=true;d.workouts[0].exercises[0].amrapLast=true;}];
    for(const mutate of mutations){const doc=structuredClone(documents[0]);mutate(doc);assert.throws(()=>parseProgramText(JSON.stringify(doc),knownExercises));}
    assert.throws(()=>parseProgramText('I want a good workout',knownExercises),/JSON/);
    assert.throws(()=>parseProgramText(' '.repeat(128*1024+1),knownExercises),/128 KiB/);
    assert.deepEqual(parseProgramText('```json\n'+JSON.stringify(documents[0])+'\n```',knownExercises),documents[0]);
  });

  await test('personal import is private, idempotent and updates keys without changing history, schedule or targets', async () => {
    const {client}=setup();const before=await client.getSnapshot();const doc=structuredClone(documents[0]);doc.key='my-import';
    let state=await client.importProgram(doc);const p=state.programs.find(p=>p.details?.key===doc.key);
    assert.deepEqual(state.schedule,before.schedule);assert.deepEqual(state.targets,before.targets);
    const repeated=await client.importProgram(structuredClone(doc));assert.equal(repeated.programs.length,state.programs.length);assert.equal(repeated.activeProgramId,p.id);
    state=await client.assignWorkout(today,p.workouts[0].id);state=await client.startWorkout(p.workouts[0].id,today);
    const history=structuredClone(state.sessions),schedule=structuredClone(state.schedule);
    const changed=structuredClone(doc);changed.name='My updated plan';changed.workouts[0].exercises[0].sets=3;
    await assert.rejects(client.importProgram(changed),/version/);
    changed.version=2;state=await client.importProgram(changed);const updated=state.programs.find(v=>v.id===p.id);
    assert.equal(updated.name,changed.name);assert.equal(updated.workouts[0].id,p.workouts[0].id);assert.equal(updated.workouts[0].exercises[0].id,p.workouts[0].exercises[0].id);
    assert.deepEqual(state.sessions,history);assert.deepEqual(state.schedule,schedule);
    const removed=structuredClone(changed);removed.version=3;removed.daysPerWeek=1;removed.workouts.shift();
    await assert.rejects(client.importProgram(removed),/assigned workouts/);assert.deepEqual(await client.getSnapshot(),state);
    await client.signIn('other-import@example.test','Other');const other=await client.importProgram(doc);assert.notEqual(other.programs.find(v=>v.details?.key===doc.key).id,p.id);
    await client.signIn(before.profile.email,before.profile.displayName);assert.deepEqual((await client.getSnapshot()).programs.find(v=>v.id===p.id),updated);
  });

  await test('shared admin upsert enforces role, revision and version and keeps personal copies frozen', async () => {
    const {client}=setup();const doc=structuredClone(documents[0]);doc.key='shared-strength';
    const published=await client.publishProgram(doc,0);assert.equal(published.revision,1);
    assert.deepEqual(await client.publishProgram(doc,0),published,'a repeated save with the same document is harmless');
    let state=await client.useTemplate(doc.key);const copy=structuredClone(state.programs.find(p=>p.id===state.activeProgramId));
    await client.signIn('member-import@example.test','Member');await rejects(client.publishProgram(doc,1),403,'admin_required');assert.ok((await client.listProgramTemplates()).some(t=>t.id===doc.key));
    await client.signIn(DEFAULT_PREVIEW_EMAIL,'Nathan');const next=structuredClone(doc);next.name='Shared revision two';
    await rejects(client.publishProgram(next,1),409,'program_version_conflict');next.version=2;
    await rejects(client.publishProgram(next,0),409,'library_revision_conflict');const update=await client.publishProgram(next,1);assert.equal(update.revision,2);
    state=await client.getSnapshot();assert.deepEqual(state.programs.find(p=>p.id===copy.id),copy);
    assert.equal((await createMockClient().listProgramTemplates()).find(t=>t.id===doc.key).name,next.name);
    state=await client.useTemplate(doc.key);assert.equal(state.programs.find(p=>p.id===state.activeProgramId).name,next.name);
    assert.notEqual(state.programs.find(p=>p.id===state.activeProgramId).details.key,copy.details.key);
  });

  await test('preview fixture totals, schedule, and completed history agree', async () => {
    const { client } = setup();
    const data = await client.getSnapshot();
    assert.equal(data.profile.displayName, 'Nathan');
    assert.equal(data.profile.role, 'admin');
    assert.equal(data.profile.email, DEFAULT_PREVIEW_EMAIL);
    const log = data.foodEntries.filter(entry => entry.date === today);
    for (const [nutrient, expected] of Object.entries({ calories: 938, protein: 33, carbs: 79, fat: 55 })) {
      assert.equal(log.reduce((sum, entry) => sum + entry[nutrient], 0), expected);
    }
    const workouts = data.programs.flatMap(program => program.workouts);
    assert.equal(workouts.find(workout => workout.id === 'lower-2').exercises.length, 7);
    assert.equal(workouts.find(workout => workout.id === 'upper-1').exercises.length, 6);
    assert.equal(data.schedule.find(slot => slot.date === today).workoutId, 'lower-2');
    assert.equal(data.schedule.find(slot => slot.date === shiftDate(today, 1)).workoutId, 'upper-1');
    assert.ok(data.sessions.length > 0);
    for (const session of data.sessions) {
      assert.ok(session.finishedAt);
      assert.ok(session.date < today);
      assert.equal(data.schedule.find(slot => slot.date === session.date).workoutId, session.workoutId);
    }
  });

  await test('asynchronous failed requests and storage failures preserve saved records', async () => {
    const { client, storage } = setup();
    const before = await client.getSnapshot();
    const persisted = storage.getItem(accountKey(before.profile.email));
    storage.setItem(DELAY_KEY, '20');
    storage.setItem(FAIL_NEXT_KEY, 'saveCheckIn');
    await client.searchFoods('banana');
    assert.equal(storage.getItem(FAIL_NEXT_KEY), 'saveCheckIn', 'nonmatching requests leave the failure hook pending');
    let settled = false;
    const rejected = client.saveCheckIn({ id: 'check-failed', date: today, weight: 99, notes: 'Unsaved draft' });
    rejected.then(() => { settled = true; }, () => { settled = true; });
    assert.equal(settled, false, 'the mock request must settle asynchronously');
    await rejects(rejected, 503, 'simulated_network_error');
    assert.equal(storage.getItem(FAIL_NEXT_KEY), null);
    assert.equal(storage.getItem(accountKey(before.profile.email)), persisted);
    assert.deepEqual(await client.getSnapshot(), before);
    await rejects(client.saveCheckIn({ id: 'invalid-date', date: '2026-02-30', weight: 57, notes: '' }), 400);
    await rejects(client.saveWeight({ id: 'invalid-weight', date: today, weight: NaN }), 400);
    storage.rejectWrites = true;
    await rejects(client.saveCheckIn({ id: 'check-storage', date: today, weight: 58, notes: 'Storage unavailable' }), 503, 'storage_unavailable');
    storage.rejectWrites = false;
    assert.deepEqual(await client.getSnapshot(), before);
  });

  await test('daily check-ins and weights upsert one date, retaining linked notes', async () => {
    const { client } = setup();
    await client.getSnapshot();
    await client.saveCheckIn({ id: 'check-a', date: today, weight: 56.8, notes: 'First note' });
    let data = await client.saveCheckIn({ id: 'check-b', date: today, weight: 57, notes: 'Updated note' });
    assert.equal(data.checkIns.filter(entry => entry.date === today).length, 1);
    assert.equal(data.weights.filter(entry => entry.date === today).length, 1);
    assert.equal(data.checkIns.find(entry => entry.date === today).id, 'check-a');
    assert.equal(data.weights.find(entry => entry.date === today).weight, 57);
    data = await client.saveWeight({ id: 'weight-other', date: today, weight: 57.1 });
    assert.equal(data.checkIns.find(entry => entry.date === today).weight, 57.1);
    assert.equal(data.checkIns.find(entry => entry.date === today).notes, 'Updated note');
    const restored = await createMockClient().getSnapshot();
    assert.deepEqual(restored.checkIns, data.checkIns);
    assert.deepEqual(restored.weights, data.weights);
  });

  await test('session snapshots, effort/completion, extra sets, notes, and rest deadlines persist', async () => {
    const { client } = setup();
    let data = await client.startWorkout('lower-2', today);
    const active = data.sessions.find(session => !session.finishedAt);
    assert.ok(active);
    const originalPrescription = structuredClone(active.exercises[0].prescription);
    data = await client.startWorkout('lower-2', today);
    assert.equal(data.sessions.filter(session => !session.finishedAt).length, 1, 'starting the same workout does not duplicate it');
    await rejects(client.startWorkout('upper-1', today), 409, 'session_already_active');
    active.exercises[0].sets[0] = { ...active.exercises[0].sets[0], weight: 60, reps: 8, effort: 'hard', completed: false };
    active.exercises[0].sets[1].completed = true;
    active.exercises[0].sets[1].effort = null;
    active.exercises[0].sets.push({ id: 'added-set', weight: 55, reps: 8, effort: null, completed: false });
    active.exercises[0].notes = 'Stay controlled';
    active.restDeadline = new Date(Date.now() + 90_000).toISOString();
    data = await client.saveSession(active);
    let saved = (await createMockClient().getSnapshot()).sessions.find(session => session.id === active.id);
    assert.equal(saved.exercises[0].sets[0].effort, 'hard');
    assert.equal(saved.exercises[0].sets[0].completed, false, 'selecting effort does not mark a set complete');
    assert.equal(saved.exercises[0].sets[1].completed, true);
    assert.equal(saved.exercises[0].sets[1].effort, null, 'completion does not choose effort');
    assert.equal(saved.exercises[0].sets.length, originalPrescription.sets + 1);
    assert.equal(saved.exercises[0].notes, 'Stay controlled');
    assert.equal(saved.restDeadline, active.restDeadline);
    const program = structuredClone(data.programs[0]);
    program.workouts.find(workout => workout.id === 'lower-2').exercises[0].repsMin += 1;
    data = await client.saveProgram(program);
    assert.deepEqual(data.sessions.find(session => session.id === active.id).exercises[0].prescription, originalPrescription);
    const changedSnapshot = structuredClone(saved);
    changedSnapshot.exercises[0].prescription.repsMin += 1;
    await rejects(client.saveSession(changedSnapshot), 400);
    data = await client.finishSession(active.id);
    saved = data.sessions.find(session => session.id === active.id);
    assert.ok(saved.finishedAt, 'users can finish a partial workout');
    assert.equal(saved.restDeadline, null);
  });

  await test('target overrides preserve earlier dates and upsert the chosen date', async () => {
    const { client } = setup();
    const initial = await client.getSnapshot();
    const earlier = initial.targets[0];
    const target = { id: earlier.id, effectiveDate: today, mode: 'manual', manuallyOverridden: true, calories: 2400, protein: 130, carbs: 300, fat: 80 };
    let data = await client.saveTargets(target);
    assert.equal(data.targets.length, 2);
    assert.deepEqual(data.targets.find(entry => entry.effectiveDate === earlier.effectiveDate), earlier);
    assert.notEqual(data.targets.find(entry => entry.effectiveDate === today).id, earlier.id);
    data = await client.saveTargets({ ...target, id: 'another-target-id', calories: 2300 });
    assert.equal(data.targets.filter(entry => entry.effectiveDate === today).length, 1);
    assert.equal(data.targets.find(entry => entry.effectiveDate === today).calories, 2300);
    await rejects(client.saveTargets({ ...target, calories: Infinity }), 400);
  });

  await test('food search/CRUD, source validation, copying, and simultaneous saves work', async () => {
    const { client } = setup();
    assert.equal((await client.searchFoods('GREEK')).length, 1);
    const food = { id: 'my-food', date: today, meal: 'Snacks', name: 'My yogurt', quantity: 1, serving: 'bowl', source: 'manual', calories: 100, protein: 17, carbs: 6, fat: 0.7 };
    await rejects(client.saveFood({ ...food, source: 'unknown-source' }), 400);
    await rejects(client.saveFood({ ...food, foodId: 'unknown-food' }), 400);
    await Promise.all([client.saveFood(food), client.saveFood({ ...food, id: 'second-food', name: 'Second snack' })]);
    let data = await client.getSnapshot();
    assert.ok(data.foodEntries.some(entry => entry.id === 'my-food'));
    assert.ok(data.foodEntries.some(entry => entry.id === 'second-food'), 'simultaneous saves must not overwrite each other');
    data = await client.saveFood({ ...food, calories: 120 });
    assert.equal(data.foodEntries.filter(entry => entry.id === 'my-food').length, 1);
    assert.equal(data.foodEntries.find(entry => entry.id === 'my-food').calories, 120);
    const sourceEntries = data.foodEntries.filter(entry => entry.date === today);
    data = await client.copyFoods(today, shiftDate(today, 3));
    const copies = data.foodEntries.filter(entry => entry.date === shiftDate(today, 3));
    assert.equal(copies.length, sourceEntries.length);
    assert.ok(copies.every(entry => !sourceEntries.some(source => source.id === entry.id)));
    await rejects(client.copyFoods(today, today), 400);
    data = await client.deleteFood('my-food');
    assert.equal(data.foodEntries.some(entry => entry.id === 'my-food'), false);
    await rejects(client.deleteFood('missing-food'), 404);
  });

  await test('lesson CRUD preserves completion/notes and rejects executable links', async () => {
    const { client } = setup();
    const lesson = { id: 'my-lesson', title: 'My lesson', url: 'https://example.com/lesson', notes: 'Important note', category: 'Training', source: 'Personal', completed: false, savedAt: new Date().toISOString() };
    await client.saveLesson(lesson);
    let data = await client.saveLesson({ ...lesson, completed: true, notes: 'Finished reading' });
    assert.equal(data.lessons.filter(entry => entry.id === lesson.id).length, 1);
    assert.equal(data.lessons.find(entry => entry.id === lesson.id).completed, true);
    assert.equal((await createMockClient().getSnapshot()).lessons.find(entry => entry.id === lesson.id).notes, 'Finished reading');
    await rejects(client.saveLesson({ ...lesson, url: 'javascript:alert(1)' }), 400);
    await rejects(client.saveLesson({ ...lesson, url: 'https://name:password@example.com/' }), 400);
    data = await client.deleteLesson(lesson.id);
    assert.equal(data.lessons.some(entry => entry.id === lesson.id), false);
  });

  await test('templates have private copy IDs, preserve AMRAP, and leave calendar choices unchanged', async () => {
    const { client } = setup();
    const initial = await client.getSnapshot();
    const templateBefore = structuredClone(templates);
    const data = await client.useTemplate('beginner-3');
    const source = templates.find(template => template.id === 'beginner-3');
    const copy = data.programs.find(program => program.id === data.activeProgramId);
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.source, source.source);
    assert.equal(copy.workouts.length, 2);
    assert.ok(copy.workouts.every(workout => !source.workouts.some(original => original.id === workout.id)));
    assert.ok(copy.workouts.flatMap(workout => workout.exercises).every(entry => entry.amrapLast === true && entry.restSeconds === 180));
    for (let index = 0; index < copy.workouts.length; index++) {
      assert.ok(copy.workouts[index].exercises.every(entry => !source.workouts[index].exercises.some(original => original.id === entry.id)));
    }
    assert.deepEqual(data.schedule, initial.schedule, 'choosing a template does not silently assign weekdays');
    copy.workouts[0].name = 'My version';
    copy.workouts[0].exercises[0].superset = '';
    await client.saveProgram(copy);
    assert.deepEqual(templates, templateBefore, 'editing a copied program does not edit the public template');
    const assigned = await client.assignWorkout(shiftDate(today, 2), copy.workouts[0].id);
    assert.equal(assigned.schedule.filter(slot => slot.date === shiftDate(today, 2)).length, 1);
    assert.equal(assigned.schedule.find(slot => slot.date === shiftDate(today, 2)).workoutId, copy.workouts[0].id);
    await rejects(client.useTemplate('missing-template'), 404);
  });

  await test('the Go catalogue matches the UI and exercise assets are available with verified provenance', async () => {
    const server = JSON.parse(await readFile(path.join(frontend, '../backend/catalogue/catalogue.json'), 'utf8'));
    assert.deepEqual(server, JSON.parse(JSON.stringify({ templates:templates.filter(t=>!t.details), programDocuments:documents, exercises, muscles, readings, foods: [], expertRules: JSON.parse(await readFile(path.join(frontend, "src/lib/expert-rules.json"), "utf8")), goalRules: JSON.parse(await readFile(path.join(frontend, "src/lib/goal-rules.json"), "utf8")) })), 'run npm run export:catalogue after catalogue edits');
    const provenance = JSON.parse(await readFile(path.join(frontend, 'static/images/exercise-provenance.json'), 'utf8'));
    for (const exercise of exercises) {
      const bytes = await readFile(path.join(frontend, 'static', exercise.image.slice(1)));
      const source = provenance.entries[exercise.id];
      if (source?.imageSha256) {
        assert.equal(createHash('sha256').update(bytes).digest('hex'), source.imageSha256, `image checksum: ${exercise.id}`);
        assert.match(source.sourceURL, /\/blob\/[a-f0-9]{40}\//);
        assert.equal(source.licence, 'Unlicense');
      }
    }
  });

  await test('every starter program copies, saves and restores its provenance and all prescription flags independently', async () => {
    const { client } = setup();
    const initial = await client.getSnapshot();
    const publicBefore = structuredClone(templates);
    const generatedIds = new Set();
    for (const source of templates) {
      let state = await client.useTemplate(source.id);
      const copy = state.programs.find(program => program.id === state.activeProgramId);
      assert.notEqual(copy.id, source.id);
      for (const key of ['source', 'sourceName', 'sourceReviewedAt', 'adaptationNote']) assert.equal(copy[key], source[key]);
      for (let wi = 0; wi < source.workouts.length; wi++) {
        const original = source.workouts[wi], workout = copy.workouts[wi];
        assert.notEqual(workout.id, original.id);
        const groups = new Map();
        for (let pi = 0; pi < original.exercises.length; pi++) {
          const prescription = workout.exercises[pi], expected = original.exercises[pi];
          assert.notEqual(prescription.id, expected.id);
          assert.ok(!generatedIds.has(prescription.id));
          generatedIds.add(prescription.id);
          if (expected.superset) {
            assert.notEqual(prescription.superset, expected.superset);
            if (groups.has(expected.superset)) assert.equal(prescription.superset, groups.get(expected.superset));
            groups.set(expected.superset, prescription.superset);
          }
          assert.deepEqual({ ...prescription, id: expected.id, superset: expected.superset }, { ...expected, superset: expected.superset });
        }
      }
      copy.name = `My ${source.name}`;
      copy.workouts[0].exercises[0].sets += 1;
      state = await client.saveProgram(copy);
      assert.deepEqual((await createMockClient().getSnapshot()).programs.find(p => p.id === copy.id), JSON.parse(JSON.stringify(copy)));
      assert.deepEqual(state.schedule, initial.schedule);
      assert.deepEqual(state.sessions, initial.sessions);
      assert.deepEqual(templates, publicBefore);
    }
  });

  await test('sign-out, restoration, account isolation, and in-flight account changes are enforced', async () => {
    const { client, storage } = setup();
    await client.saveCheckIn({ id: 'my-private-check-in', date: today, weight: 57.3, notes: 'Nathan’s private note' });
    const nathanStored = storage.getItem(accountKey(DEFAULT_PREVIEW_EMAIL));
    await client.signOut();
    assert.equal(storage.getItem(ACTIVE_KEY), 'signed-out');
    await rejects(createMockClient().getSnapshot(), 401, 'not_signed_in');
    let data = await client.signIn('NEW.USER@EXAMPLE.COM', 'New User');
    assert.equal(data.profile.email, 'new.user@example.com');
    assert.equal(data.profile.role, 'user');
    assert.equal(data.checkIns.some(entry => entry.date === today), false);
    data.profile.role = 'admin';
    assert.equal((await client.getSnapshot()).profile.role, 'user', 'returned snapshots are detached from persisted records');
    await rejects(client.updateProfile({ role: 'admin' }), 403);
    await rejects(client.updateProfile({ email: DEFAULT_PREVIEW_EMAIL }), 403);
    assert.equal(storage.getItem(accountKey(DEFAULT_PREVIEW_EMAIL)), nathanStored);
    data = await client.signIn(DEFAULT_PREVIEW_EMAIL);
    assert.equal(data.checkIns.find(entry => entry.date === today).notes, 'Nathan’s private note');
    storage.setItem(DELAY_KEY, '20');
    const inFlight = client.saveCheckIn({ id: 'changed-account-save', date: today, weight: 99, notes: 'Must not cross accounts' });
    storage.setItem(ACTIVE_KEY, 'new.user@example.com');
    await rejects(inFlight, 409, 'account_changed');
    assert.equal(storage.getItem(accountKey(DEFAULT_PREVIEW_EMAIL)), nathanStored);
    assert.equal((await client.getSnapshot()).checkIns.some(entry => entry.notes === 'Must not cross accounts'), false);
    data = await client.signIn(`${'a'.repeat(240)}@example.com`);
    assert.ok(data.profile.displayName.length <= 80, 'valid long emails still create preview accounts');
    data = await client.signIn(DEFAULT_PREVIEW_EMAIL);
    data = await client.resetPreview();
    assert.equal(data.checkIns.some(entry => entry.date === today), false);
  });

  await test('admin preview settings reject credentials; simulated AI drafts never save foods', async () => {
    const { client, storage } = setup();
    await client.getSnapshot();
    const config = { provider: 'openrouter', model: 'Preview vision model', enabled: true, configured: true };
    await rejects(client.saveProvider({ ...config, apiKey: 'must-not-be-stored-test-marker' }), 400);
    await rejects(client.saveProvider({ ...config, model: '' }), 400);
    assert.equal([...storage.records.values()].some(value => value.includes('must-not-be-stored-test-marker')), false);
    let data = await client.saveProvider(config);
    assert.deepEqual(data.provider, config);
    let actualCalls = 0;
    globalThis.fetch = async () => { actualCalls++; throw new Error('Mock AI must not make a real request'); };
    const answer = await client.askQuestion('How much protein did I log today?');
    assert.equal(answer.preview, true);
    assert.match(answer.answer, /simulated/i);
    assert.match(answer.answer, /33/);
    const foodLog = structuredClone(data.foodEntries);
    const estimate = await client.estimateMeal(new File(['sample photo data'], 'meal.png', { type: 'image/png' }));
    assert.equal(estimate.preview, true);
    assert.ok(estimate.items.length > 0);
    assert.match(estimate.assumptions, /simulated/i);
    assert.deepEqual((await client.getSnapshot()).foodEntries, foodLog, 'estimating a photo does not create food entries');
    assert.equal(actualCalls, 0);
    await rejects(client.estimateMeal(new File(['<svg></svg>'], 'meal.svg', { type: 'image/svg+xml' })), 400);
    data = await client.saveProvider({ ...config, enabled: false });
    await rejects(client.askQuestion('Help'), 503, 'provider_disabled');
    await client.signIn('member@example.com');
    await rejects(client.saveProvider(config), 403, 'admin_required');
  });
} finally {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
  await rm(output, { recursive: true, force: true });
}

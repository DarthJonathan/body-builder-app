import { test as liveTest, expect, registerAccount, backendSnapshot, openCheckIn, saveCheckIn, pendingOperations, today, createAndScheduleTemplate } from './helpers';
import { createOfflineProxy, type OfflineProxy } from '../offline-proxy';

const test = liveTest.extend<{ offlineProxy: OfflineProxy }>({
  offlineProxy: async ({ baseURL }, use) => {
    const proxy = await createOfflineProxy(baseURL!);
    try { await use(proxy); }
    finally { await proxy.close(); }
  }
});

test('production offline edits retain retry identity through reload and replay once into PostgreSQL', async ({ page: app, offlineProxy, baseURL }, testInfo) => {
  const errors: string[] = [];
  app.on('pageerror', error => errors.push(error.message));
  await app.goto(offlineProxy.origin);
  const account = await registerAccount(app, testInfo, 'offline');
  const date = await today(app);
  const initial = await backendSnapshot(app, account.token);
  await app.evaluate(async () => { await navigator.serviceWorker.ready; });
  await app.reload();
  await expect.poll(() => app.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  offlineProxy.setAvailable(false);
  const rejected = await app.evaluate(async () => {
    try { await fetch(`/__offline_probe__?id=${crypto.randomUUID()}`, { cache: 'no-store' }); return false; }
    catch { return true; }
  });
  expect(rejected, 'Verify the actual origin transport is unavailable').toBe(true);
  await openCheckIn(app);
  await saveCheckIn(app, '58.7', 'A durable real-account offline note.');
  await expect(app.getByText(/Pending changes|Offline/, { exact: false }).first()).toBeVisible();
  await expect.poll(async () => (await pendingOperations(app, account.userId)).length).toBe(1);
  const queued = await pendingOperations(app, account.userId);
  expect(queued[0]).toEqual(expect.objectContaining({ operation: 'saveCheckIn', baseRevision: initial.revision }));
  expect(queued[0].id).toBeTruthy();
  const stillSaved = await backendSnapshot(app, account.token, baseURL!);
  expect(stillSaved.revision).toBe(initial.revision);
  expect(stillSaved.checkIns).toEqual([]);
  await app.reload();
  await expect(app.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(await pendingOperations(app, account.userId)).toEqual(queued);
  await openCheckIn(app);
  await expect(app.getByRole('dialog').getByLabel('Weight (kg)', { exact: true })).toHaveValue('58.7');
  await expect(app.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('A durable real-account offline note.');
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  offlineProxy.setAvailable(true);
  const replayed = app.waitForResponse(response => {
    if (new URL(response.url()).pathname !== '/api/v1/mutations' || response.request().method() !== 'POST') return false;
    return response.request().postDataJSON()?.id === queued[0].id && response.status() === 200;
  });
  await app.evaluate(() => window.dispatchEvent(new Event('online')));
  await replayed;
  await expect.poll(async () => (await pendingOperations(app, account.userId)).length).toBe(0);
  const saved = await backendSnapshot(app, account.token);
  expect(saved.revision).toBe(initial.revision + 1);
  expect(saved.checkIns).toHaveLength(1);
  expect(saved.weights).toHaveLength(1);
  expect(saved.checkIns[0]).toEqual(expect.objectContaining({ date, weight: 58.7, notes: 'A durable real-account offline note.' }));
  expect(saved.weights[0]).toEqual(expect.objectContaining({ date, weight: 58.7 }));
  await app.reload();
  await openCheckIn(app);
  await expect(app.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('A durable real-account offline note.');
  const cachePaths = await app.evaluate(async () => {
    const requests = (await Promise.all((await caches.keys()).map(async key => (await caches.open(key)).keys()))).flat();
    return requests.map(request => new URL(request.url).pathname);
  });
  expect(cachePaths.some(path => path.startsWith('/api/'))).toBe(false);
  expect(errors, 'The live production PWA should not emit uncaught page errors').toEqual([]);
});

test('a workout finished offline retains its actual stop time through reload and delayed replay', async ({ page: app, offlineProxy, baseURL }, testInfo) => {
  const errors: string[] = [];
  app.on('pageerror', error => errors.push(error.message));
  await app.goto(offlineProxy.origin);
  const account = await registerAccount(app, testInfo, 'offline-finish');
  await app.evaluate(async () => { await navigator.serviceWorker.ready; });
  await app.reload();
  await expect.poll(() => app.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await createAndScheduleTemplate(app, account.token);
  await app.getByRole('button', { name: 'Get Started', exact: true }).click();
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  await expect.poll(async () => (await backendSnapshot(app, account.token)).sessions.length).toBe(1);
  await expect.poll(async () => (await pendingOperations(app, account.userId)).length).toBe(0);
  const initial = await backendSnapshot(app, account.token);
  const session = initial.sessions[0];
  expect(session.finishedAt).toBeNull();

  offlineProxy.setAvailable(false);
  expect(await app.evaluate(async () => {
    try { await fetch(`/__offline_probe__?id=${crypto.randomUUID()}`, { cache: 'no-store' }); return false; }
    catch { return true; }
  }), 'Verify workout completion happens without origin transport').toBe(true);
  await app.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(app.getByRole('dialog')).toBeVisible();
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(async () => (await pendingOperations(app, account.userId)).length).toBe(2);
  const queued = await pendingOperations(app, account.userId);
  expect(queued.map(item => item.operation)).toEqual(['saveSession', 'finishSession']);
  expect(queued.map(item => item.baseRevision)).toEqual([initial.revision, initial.revision + 1]);
  expect(queued.every(item => Boolean(item.id))).toBe(true);
  expect(new Set(queued.map(item => item.id)).size).toBe(2);
  expect(queued[0].payload).toEqual(expect.objectContaining({ id: session.id, finishedAt: null }));
  const completion = queued[1].payload as { sessionId: string; finishedAt: string };
  expect(completion.sessionId).toBe(session.id);
  expect(Number.isFinite(Date.parse(completion.finishedAt))).toBe(true);
  expect(Date.parse(completion.finishedAt)).toBeGreaterThanOrEqual(Date.parse(session.startedAt));
  const beforeReplay = await backendSnapshot(app, account.token, baseURL!);
  expect(beforeReplay.revision).toBe(initial.revision);
  expect(beforeReplay.sessions).toEqual(initial.sessions);

  await app.reload();
  await expect(app.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(await pendingOperations(app, account.userId)).toEqual(queued);
  const acknowledgedIds: string[] = [];
  app.on('response', response => {
    if (new URL(response.url()).pathname !== '/api/v1/mutations' || response.request().method() !== 'POST' || response.status() !== 200) return;
    const id = response.request().postDataJSON()?.id;
    if (queued.some(item => item.id === id)) acknowledgedIds.push(id);
  });
  const acknowledged = Promise.all(queued.map(item => app.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/mutations'
    && response.request().method() === 'POST' && response.request().postDataJSON()?.id === item.id && response.status() === 200)));
  offlineProxy.setAvailable(true);
  await app.evaluate(() => window.dispatchEvent(new Event('online')));
  await acknowledged;
  await expect.poll(async () => (await pendingOperations(app, account.userId)).length).toBe(0);
  const saved = await backendSnapshot(app, account.token);
  expect(saved.revision).toBe(initial.revision + 2);
  expect(saved.sessions).toHaveLength(1);
  expect(Date.parse(saved.sessions[0].finishedAt!)).toBe(Date.parse(completion.finishedAt));
  expect(saved.sessions[0].id).toBe(session.id);
  await app.reload();
  const durable = await backendSnapshot(app, account.token);
  expect(durable.revision).toBe(saved.revision);
  expect(durable.sessions[0].finishedAt).toBe(saved.sessions[0].finishedAt);
  expect(acknowledgedIds).toEqual(queued.map(item => item.id));
  expect(errors, 'Offline completion and replay should not emit uncaught page errors').toEqual([]);
});

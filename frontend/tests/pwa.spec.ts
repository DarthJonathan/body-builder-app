import { test as previewTest, expect, openCheckIn, fillCheckIn, openTodayWorkout, snapshot, TODAY, FIXED_NOW } from './helpers';
import { createOfflineProxy, type OfflineProxy } from './offline-proxy';

const test = previewTest.extend<{ offlineProxy: OfflineProxy }>({
  offlineProxy: async ({ baseURL }, use) => {
    const proxy = await createOfflineProxy(baseURL!);
    try { await use(proxy); }
    finally { await proxy.close(); }
  }
});

test('production shell and local preview records remain usable across an offline reload', async ({ page: app, offlineProxy }, testInfo) => {
  const pageErrors: string[] = [];
  app.on('pageerror', error => pageErrors.push(error.message));
  await app.clock.install({ time: new Date(FIXED_NOW) });
  await app.goto(offlineProxy.origin);
  await expect(app.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  const manifestHref = await app.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifestURL = new URL(manifestHref!, app.url());
  const manifestResponse = await app.request.get(manifestURL.toString());
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toEqual(expect.objectContaining({ name: 'BodyBuilder', display: 'standalone', start_url: '/' }));
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }), expect.objectContaining({ sizes: '512x512' })
  ]));
  for (const icon of manifest.icons) {
    const response = await app.request.get(new URL(icon.src, manifestURL).toString());
    expect(response.ok(), `Manifest icon is accessible: ${icon.src}`).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^image\//);
  }

  await app.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) throw new Error('The production service worker did not activate');
  });
  await app.reload();
  await expect.poll(() => app.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Drop every incoming socket at the origin. Unlike browser routing, this also
  // blocks service-worker-owned network requests without engine-specific flags.
  offlineProxy.setAvailable(false);
  testInfo.annotations.push({ type: 'offline-transport', description: 'A dedicated proxy origin drops all transport sockets; uncached fetch rejection verified.' });
  const uncachedFetchRejected = await app.evaluate(async () => {
    try {
      await fetch(`/__bodybuilder_offline_probe__?id=${crypto.randomUUID()}`, { cache: 'no-store' });
      return false;
    } catch {
      return true;
    }
  });
  expect(uncachedFetchRejected, 'A new uncached resource must be unreachable during offline checks').toBe(true);
  await app.reload();
  await expect(app.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  await openCheckIn(app);
  await fillCheckIn(app, '58.3', 'Recorded while this preview was offline.');
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async () => (await snapshot(app)).checkIns.find(item => item.date === TODAY)?.weight).toBe(58.3);

  await app.reload();
  await openCheckIn(app);
  await expect(app.getByRole('dialog').getByLabel('Notes', { exact: true })).toHaveValue('Recorded while this preview was offline.');
  await app.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await openTodayWorkout(app);
  await expect(app.getByRole('heading', { name: 'Target Muscles', exact: true })).toBeVisible();
  await expect.poll(() => app.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('img[src$=".jpg"]');
    return Boolean(image?.complete && image.naturalWidth > 0);
  }), { message: 'The exercise image must be precached and render without network access' }).toBe(true);
  await app.getByRole('button', { name: 'Start Workout', exact: true }).click();
  await expect(app.getByLabel('Barbell Deadlift set 1 reps', { exact: true })).toBeVisible();
  await app.getByLabel('Barbell Deadlift set 1 reps', { exact: true }).fill('9');
  await app.getByRole('button', { name: 'Effort for Barbell Deadlift set 1', exact: true }).click();
  await app.getByRole('button', { name: /^Medium/ }).click();
  await expect.poll(async () => (await snapshot(app)).sessions.find(session => !session.finishedAt)?.exercises[0].sets[0].reps).toBe(9);
  await app.reload();
  await expect(app.getByLabel('Barbell Deadlift set 1 reps', { exact: true })).toHaveValue('9');
  offlineProxy.setAvailable(true);

  // This verifies the preview's local persistence and cached shell, not Go synchronization.
  const cachedURLs = await app.evaluate(async () => {
    const requests = (await Promise.all((await caches.keys()).map(async key => (await caches.open(key)).keys()))).flat();
    return requests.map(request => request.url);
  });
  expect(cachedURLs.some(url => new URL(url).pathname.startsWith('/api/'))).toBe(false);
  expect(pageErrors, 'The production preview should not emit uncaught page errors').toEqual([]);
});

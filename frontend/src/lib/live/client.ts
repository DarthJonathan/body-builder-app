import { writable } from 'svelte/store';
import { api, APIError, register, signIn, type Session } from '../api';
import type { AppSnapshot, Food, NutritionTargets, ProviderConfig, SyncState, TrainingClient } from '../domain';
import { id } from '../domain';
import { calculateNutritionTargets, sameCalculationProvenance } from '../nutrition';
import * as validate from '../mock/validation';
import { clone, readAccount, readSession, SESSION_KEY, updateAccount, writeSession, type AccountCache, type Operation } from './storage';
import { project } from './projection';

export const syncState = writable<SyncState>({ phase: 'signed-out', pending: 0, revision: 0, message: '', operations: [] });

function snapshot(value: unknown, userId: string): AppSnapshot {
  const result = value as AppSnapshot;
  if (!result || result.profile?.id !== userId || !Number.isSafeInteger(result.revision) || (result.revision ?? -1) < 0 ||
    !['programs', 'schedule', 'sessions', 'foodEntries', 'targets', 'checkIns', 'weights', 'lessons'].every(key => Array.isArray((result as unknown as Record<string, unknown>)[key]))) {
    throw new APIError('The server returned invalid account data. Please try again.');
  }
  const copy = clone(result);
  copy.provider = publicProvider(copy.provider);
  return copy;
}
function publicProvider(value: ProviderConfig): ProviderConfig {
  return { provider: value.provider, model: value.model, enabled: value.enabled, configured: value.configured,
    ...(value.dailyRequestLimit === undefined ? {} : { dailyRequestLimit: value.dailyRequestLimit }) };
}
function online(): boolean { return typeof navigator === 'undefined' || navigator.onLine; }
function message(error: unknown): string { return error instanceof Error ? error.message : 'Cannot sync right now. Please try again.'; }

export function createLiveClient(): TrainingClient {
  let session: Session | null = null;
  let account: AccountCache | null = null;
  let epoch = 0;
  let initialized = false;
  let editing = false;
  let sequence: Promise<unknown> = Promise.resolve();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | undefined;
  const listeners = new Set<(value: AppSnapshot | null) => void>();

  function emit(value: AppSnapshot | null): void { for (const listener of listeners) listener(value ? clone(value) : null); }
  function status(phase?: SyncState['phase'], text = ''): void {
    let resolved = phase ?? (account?.conflict ? 'conflict' : account?.blockedError ? 'error' : account?.outbox.length ? (online() ? 'pending' : 'offline') : 'synced');
    if (!session && resolved !== 'expired') resolved = 'signed-out';
    syncState.set({ phase: resolved, pending: account?.outbox.length ?? 0, revision: account?.server.revision ?? 0,
      message: text || account?.blockedError || (account?.conflict ? 'Another device saved newer data. Your pending changes are still on this device.' : ''),
      operations: account?.outbox.map(item => item.operation) ?? [] });
  }
  function adopt(next: AccountCache, context: Session): void {
    if (session?.user.id !== context.user.id || session?.token !== context.token) return;
    account = next; status(); emit(next.view);
  }
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = sequence.then(work, work); sequence = next.catch(() => undefined); return next;
  }
  function expire(text = 'Your sign-in expired. Sign in again to sync your saved changes.'): never {
    epoch++; session = null; account = null; writeSession(null); clearTimeout(retryTimer); emit(null); status('expired', text);
    throw new APIError(text, 401, 'expired_auth');
  }
  function authenticate(): Session {
    initialize();
    if (!session) throw new APIError('Sign in to open your account.', 401, 'unauthenticated');
    if (Date.parse(session.expiresAt) <= Date.now()) return expire();
    return session;
  }
  async function authorized<T>(path: string, options: RequestInit = {}, context = authenticate()): Promise<T> {
    const generation=epoch;
    try {
      const result=await api<T>(path, options, context.token);
      if(generation!==epoch || session?.token!==context.token) throw new APIError('The account changed. Open your current account to continue.',401,'account_changed');
      return result;
    }
    catch(error) {
      if(error instanceof APIError && error.status===401 && error.code!=='account_changed' && session?.token===context.token && generation===epoch) return expire();
      throw error;
    }
  }
  function initialize(): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true; session = readSession();
    const refresh = () => { if (session) void client.refresh!().catch(() => undefined); };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    window.addEventListener('offline', () => status('offline', 'You are offline. Changes are saved on this device.'));
    window.addEventListener('storage', event => {
      if (event.key !== SESSION_KEY) return;
      epoch++; session = readSession(); account = null; emit(null); status(); refresh();
    });
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('bodybuilder-live-sync');
      channel.onmessage = event => {
        if (event.data?.userId === session?.user.id) refresh();
      };
    }
  }
  function retryLater(): void {
    clearTimeout(retryTimer);
    if (session && account?.outbox.length && !account.conflict && !account.blockedError) {
      retryTimer = setTimeout(() => { if (session) void client.refresh!().catch(() => undefined); }, 15_000);
    }
  }
  function announce(context: Session): void { channel?.postMessage({ userId: context.user.id }); }

  async function load(context: Session): Promise<AccountCache | null> {
    const saved = await readAccount(context.user.id);
    if (saved) adopt(saved, context);
    return saved;
  }
  async function flush(context: Session): Promise<AccountCache> {
    let current = await load(context);
    if (!current) throw new APIError('Connect once to open this account on your device.');
    while (current.outbox.length && !current.conflict && !current.blockedError) {
      if (!online()) { status('offline', 'You are offline. Changes are saved on this device.'); retryLater(); break; }
      if (session?.token !== context.token) throw new APIError('The account changed. Open your current account to continue.', 401);
      status('syncing');
      const pending = current.outbox[0];
      try {
        const remote = snapshot(await authorized<AppSnapshot>('mutations', { method: 'POST', body: JSON.stringify({
          id: pending.id, baseRevision: pending.baseRevision, operation: pending.operation, payload: pending.payload
        }) }, context), context.user.id);
        current = await updateAccount(context.user.id, saved => {
          const latest = saved ?? current!;
          latest.outbox = latest.outbox.filter(item => item.id !== pending.id);
          if((remote.revision ?? 0)>=(latest.server.revision ?? 0)) latest.server = remote;
          latest.view = project(latest.server, latest.outbox); delete latest.blockedError;
          return latest;
        });
        adopt(current, context); announce(context);
      } catch (error) {
        if (error instanceof APIError && error.status === 401) throw error;
        if (error instanceof APIError && error.status === 409 && error.code === 'revision_conflict') {
          const remote = snapshot(error.data, context.user.id);
          current = await updateAccount(context.user.id, saved => ({ ...(saved ?? current!), conflict: remote }));
          adopt(current, context); break;
        }
        if (error instanceof APIError && error.temporary) {
          status(online() ? 'pending' : 'offline', 'Changes are saved on this device. Sync will retry when the connection returns.');
          retryLater(); break;
        }
        current = await updateAccount(context.user.id, saved => ({ ...(saved ?? current!), blockedError: message(error) }));
        adopt(current, context);
        throw error;
      }
    }
    return current;
  }
  async function refreshNow(): Promise<AppSnapshot> {
    const context = authenticate();
    let current = await load(context);
    if (current?.outbox.length) current = await flush(context);
    if (current?.conflict || current?.blockedError || current?.outbox.length) return clone(current.view);
    if (!online() && current) { status('offline', 'You are offline. Your saved data is available on this device.'); return clone(current.view); }
    try {
      const remote = snapshot(await authorized<AppSnapshot>('snapshot', {}, context), context.user.id);
      if (session?.token !== context.token) throw new APIError('The account changed. Open your current account to continue.', 401);
      current = await updateAccount(context.user.id, saved => {
        // Keep the draft's original revision. Its save will reach conflict handling if necessary.
        if (saved && (saved.outbox.length || (editing && remote.revision !== saved.server.revision))) return saved;
        return { userId: context.user.id, server: remote, view: remote, outbox: [] };
      });
      adopt(current, context); return clone(current.view);
    } catch (error) {
      if (error instanceof APIError && error.status === 401) throw error;
      if (current && error instanceof APIError && error.temporary) {
        status(online() ? 'pending' : 'offline', 'Cannot connect right now. Your saved data is available on this device.');
        return clone(current.view);
      }
      status('error', message(error)); throw error;
    }
  }
  async function login(next: Session): Promise<AppSnapshot> {
    epoch++; writeSession(next); session = next; account = null; editing = false; clearTimeout(retryTimer);
    emit(null);
    return refreshNow();
  }
  async function enqueue(operation: Operation, payload: unknown): Promise<AppSnapshot> {
    const context = authenticate();
    const captured = clone(payload);
    const current = account?.userId===context.user.id ? account : await load(context);
    if (!current) throw new APIError('Connect once to open this account on your device.');
    const updated = await updateAccount(context.user.id, saved => {
      const latest = saved ?? current;
      const baseRevision = latest.outbox.length ? latest.outbox[latest.outbox.length - 1].baseRevision + 1 : latest.server.revision ?? 0;
      latest.outbox.push({ id: crypto.randomUUID(), baseRevision, operation, payload: captured, createdAt: new Date().toISOString() });
      latest.view = project(latest.server, latest.outbox); return latest;
    });
    adopt(updated, context); announce(context);
    const result = await flush(context);
    return clone(result.view);
  }
  function mutate(operation: Operation, payload: unknown): Promise<AppSnapshot> {
    // Capture reactive form values before another UI event can edit them.
    const captured = clone(payload);
    return serial(() => enqueue(operation, captured));
  }
  function validateProfile(patch: unknown): void {
    const values = validate.record(patch, 'Account changes');
    const allowed = ['displayName', 'timezone', 'unit', 'goal', 'startWeight', 'goalStartedAt'];
    if (Object.keys(values).some(key => !allowed.includes(key))) throw new Error('Account identity and role cannot be changed here.');
    if (values.displayName !== undefined) validate.string(values.displayName, 'Display name', 80);
    if (values.timezone !== undefined) {
      validate.string(values.timezone, 'Timezone', 100);
      try { new Intl.DateTimeFormat('en', { timeZone: values.timezone as string }); } catch { throw new Error('Choose a valid timezone.'); }
    }
    if (values.unit !== undefined) validate.choice(values.unit, ['kg', 'lb'], 'Weight unit');
    if (values.goal !== undefined) validate.choice(values.goal, ['build-muscle', 'maintain', 'lose-fat'], 'Goal');
    if (values.startWeight !== undefined) validate.number(values.startWeight, 'Starting weight', 0, 700);
    if (values.goalStartedAt !== undefined) validate.date(values.goalStartedAt, 'Goal start date');
  }

  const client: TrainingClient = {
    getSnapshot: () => serial(refreshNow),
    getAcknowledgedSnapshot: async () => {
      const context = authenticate(), generation = epoch;
      const saved = await readAccount(context.user.id);
      if (generation !== epoch || session?.token !== context.token) throw new APIError('The account changed. Open your current account to continue.', 401, 'account_changed');
      return saved ? clone(saved.server) : null;
    },
    refresh: () => serial(refreshNow),
    signIn: (email, password = '') => serial(async () => {
      initialize(); return login(await signIn(email.trim().toLowerCase(), password));
    }),
    signUp: (displayName, email, password) => serial(async () => {
      initialize(); return login(await register(displayName.trim(), email.trim().toLowerCase(), password));
    }),
    signOut: () => serial(async () => {
      initialize(); epoch++; writeSession(null); session = null; account = null; editing = false;
      clearTimeout(retryTimer); emit(null); status('signed-out');
    }),
    resetPreview: async () => { throw new Error('Reset Preview Data is only available in explicit preview mode.'); },
    updateProfile: patch => { validateProfile(patch); return mutate('updateProfile', patch); },
    saveProgram: program => { validate.program(program); return mutate('saveProgram', program); },
    useTemplate: templateId => { validate.identifier(templateId, 'Template ID'); return mutate('useTemplate', { templateId }); },
    assignWorkout: (date, workoutId) => {
      validate.date(date); if (workoutId !== null) validate.identifier(workoutId, 'Workout ID');
      return mutate('assignWorkout', { date, workoutId });
    },
    startWorkout: (workoutId, date) => { validate.date(date); validate.identifier(workoutId, 'Workout ID'); return mutate('startWorkout', { date, workoutId }); },
    saveSession: value => { validate.session(value); return mutate('saveSession', value); },
    finishSession: (sessionId, finishedAt = new Date().toISOString()) => {
      validate.identifier(sessionId, 'Session ID'); validate.timestamp(finishedAt, 'Finish time');
      return mutate('finishSession', { sessionId, finishedAt });
    },
    saveFood: entry => { validate.foodEntry(entry); return mutate('saveFood', entry); },
    deleteFood: recordId => { validate.identifier(recordId); return mutate('deleteFood', { id: recordId }); },
    copyFoods: (fromDate, toDate) => { validate.date(fromDate); validate.date(toDate); return mutate('copyFoods', { fromDate, toDate }); },
    searchFoods: async query => {
      validate.string(query, 'Food search', 200, true); const context = authenticate();
      return authorized<Food[]>(`foods/search?q=${encodeURIComponent(query.trim())}`, {}, context);
    },
    saveTargets: targets => {
      validate.targets(targets, true);
      const copy = clone(targets);
      const existing = account?.view.targets.find(item => item.effectiveDate === targets.effectiveDate);
      if (copy.mode === 'manual' && existing?.calculation) {
        if (copy.calculation && !sameCalculationProvenance(copy.calculation, existing.calculation)) throw new Error('A manual override must retain the original calculation. Calculate targets again to replace it.');
        copy.calculation = clone(existing.calculation); copy.manuallyOverridden = true;
      }
      return mutate('saveTargets', copy);
    },
    saveCheckIn: checkIn => { validate.checkIn(checkIn); return mutate('saveCheckIn', checkIn); },
    saveWeight: entry => { validate.weight(entry); return mutate('saveWeight', entry); },
    saveLesson: lesson => { validate.lesson(lesson); return mutate('saveLesson', lesson); },
    deleteLesson: recordId => { validate.identifier(recordId); return mutate('deleteLesson', { id: recordId }); },
    saveProvider: config => serial(async () => {
      const context = authenticate();
      if (account?.view.profile.role !== 'admin') throw new APIError('Only an administrator can change AI settings.', 403);
      const { provider, model, enabled, apiKey, dailyRequestLimit } = config;
      // The API key exists only in this request, never in the account envelope.
      const result = publicProvider(await authorized<ProviderConfig>('admin/provider', { method: 'PUT', body: JSON.stringify({ provider, model, enabled, apiKey, dailyRequestLimit }) }, context));
      const updated = await updateAccount(context.user.id, saved => {
        if (!saved) throw new Error('Open this account again to continue.');
        saved.server.provider = result; saved.view = project(saved.server, saved.outbox); return saved;
      });
      adopt(updated, context); return clone(updated.view);
    }),
    testProvider: async () => {
      const result=await authorized<{answer:string;preview:false}>('admin/provider/test', {method:'POST',signal:AbortSignal.timeout(50_000)});
      return {message:result.answer};
    },
    askQuestion: async question => {
      validate.string(question, 'Your question', 5_000);
      return authorized('assistant/question', { method: 'POST', body: JSON.stringify({ question }), signal: AbortSignal.timeout(50_000) });
    },
    estimateMeal: async image => {
      if (!['image/jpeg', 'image/png'].includes(image.type)) throw new Error('Choose a JPEG or PNG photo. Convert HEIC or other image formats before uploading.');
      if (image.size > 7_000_000) throw new Error('Choose a photo smaller than 7 MB.');
      const body = new FormData(); body.append('image', image);
      return authorized('assistant/meal', { method: 'POST', body, signal: AbortSignal.timeout(50_000) });
    },
    calculateTargets: async (input, onOffline) => {
      const context = authenticate(), generation = epoch;
      const local = calculateNutritionTargets(input, id('targets'));
      let result: NutritionTargets;
      try {
        result = await authorized<NutritionTargets>('nutrition/calculate', { method: 'POST', body: JSON.stringify(input) }, context);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 0) throw error;
        if (generation !== epoch || session?.token !== context.token) throw new APIError('The account changed. Open your current account to continue.', 401, 'account_changed');
        authenticate(); onOffline?.(); return clone(local);
      }
      validate.targets(result, true);
      if (result.mode !== 'calculated' || !sameCalculationProvenance(result.calculation, local.calculation)) throw new APIError('The server calculation does not match the selected inputs. Please try again.', 502, 'invalid_calculation');
      return clone(result);
    },
    resolveConflict: resolution => serial(async () => {
      const context = authenticate();
      const current = await readAccount(context.user.id);
      if (!current?.conflict) return refreshNow();
      const resolved = await updateAccount(context.user.id, saved => {
        if (!saved?.conflict) throw new Error('This conflict has already been resolved. Refresh to continue.');
        saved.server = saved.conflict; delete saved.conflict; delete saved.blockedError;
        if (resolution === 'use-server') saved.outbox = [];
        else saved.outbox.forEach((item, index) => { item.baseRevision = (saved.server.revision ?? 0) + index; });
        saved.view = project(saved.server, saved.outbox); return saved;
      });
      adopt(resolved, context); announce(context);
      return clone((await flush(context)).view);
    }),
    discardPending: () => serial(async () => {
      const context = authenticate();
      const updated = await updateAccount(context.user.id, saved => {
        if (!saved) throw new Error('Open this account again to continue.');
        saved.server = saved.conflict ?? saved.server; saved.outbox = []; delete saved.conflict; delete saved.blockedError;
        saved.view = clone(saved.server); return saved;
      });
      adopt(updated, context); announce(context); return clone(updated.view);
    }),
    subscribe: listener => { initialize(); listeners.add(listener); return () => listeners.delete(listener); },
    setEditing: active => { const previous = editing; editing = active; if (previous && !active && session) void client.refresh!().catch(() => undefined); }
  };
  return client;
}

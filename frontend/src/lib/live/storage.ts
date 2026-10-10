import type { AppSnapshot } from '../domain';
import type { Session } from '../api';

export const SESSION_KEY = 'bodybuilder.live.session';
export type Operation = 'updateProfile' | 'saveProgram' | 'useTemplate' | 'assignWorkout' | 'startWorkout' |
  'saveSession' | 'finishSession' | 'saveFood' | 'deleteFood' | 'copyFoods' | 'saveTargets' |
  'saveCheckIn' | 'saveWeight' | 'saveLesson' | 'deleteLesson';
export type PendingMutation = {
  id: string; baseRevision: number; operation: Operation; payload: unknown; createdAt: string;
};
export type AccountCache = {
  userId: string; server: AppSnapshot; view: AppSnapshot; outbox: PendingMutation[];
  conflict?: AppSnapshot; blockedError?: string;
};

export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function readSession(): Session | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Session;
    if (!value.token || !value.user?.id || !value.user.email || !Number.isFinite(Date.parse(value.expiresAt))) return null;
    return value;
  } catch { return null; }
}
export function writeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { throw new Error('This browser cannot save your sign-in. Enable website storage, then try again.'); }
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot save changes offline. Enable website storage to continue.')); return; }
    const request = indexedDB.open('bodybuilder.live.v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('accounts', { keyPath: 'userId' });
    request.onerror = () => reject(new Error('Cannot open your device storage. Enable website storage, then try again.'));
    request.onblocked = () => reject(new Error('Another BodyBuilder tab needs to close before device storage can update.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
export async function readAccount(userId: string): Promise<AccountCache | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('accounts', 'readonly');
    const request = transaction.objectStore('accounts').get(userId);
    request.onerror = () => reject(new Error('Cannot read your saved device data. Please try again.'));
    request.onsuccess = () => resolve(request.result ? clone(request.result as AccountCache) : null);
  });
}
/** A read and write share one transaction, including when another tab is saving. */
export async function updateAccount(userId: string, change: (current: AccountCache | null) => AccountCache): Promise<AccountCache> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('accounts', 'readwrite');
    const store = transaction.objectStore('accounts');
    const request = store.get(userId);
    let updated: AccountCache;
    request.onsuccess = () => {
      try {
        updated = change(request.result ? clone(request.result as AccountCache) : null);
        if (updated.userId !== userId || updated.view.profile.id !== userId || updated.server.profile.id !== userId) {
          throw new Error('The saved data belongs to another account. Sign in again to continue.');
        }
        store.put(clone(updated));
      } catch (error) { transaction.abort(); reject(error); }
    };
    transaction.oncomplete = () => resolve(clone(updated));
    transaction.onerror = () => reject(new Error('Your device could not save this change. Free some storage, then try again.'));
    transaction.onabort = () => reject(new Error('Your device could not save this change. Please try again.'));
  });
}

import type { AppSnapshot } from '../domain';
import { localDate } from '../domain';
import { MockApiError } from './errors';
import { snapshot as validateSnapshot } from './validation';

export const DEFAULT_PREVIEW_EMAIL = 'nathan@preview.bodybuilder.app';
export const FAIL_NEXT_KEY = 'bodybuilder.preview.fail-next';
export const DELAY_KEY = 'bodybuilder.preview.delay-ms';
export const ACTIVE_KEY = 'bodybuilder.preview.active';
export const ACCOUNT_PREFIX = 'bodybuilder.preview.account.v1:';
const SIGNED_OUT = 'signed-out';

function storage(): Storage {
  if (typeof window === 'undefined') throw new MockApiError('The local preview is available in your browser.', 503, 'browser_required');
  try {
    return window.localStorage;
  } catch {
    throw new MockApiError('Your browser could not access preview storage. Allow local storage and try again.', 503, 'storage_unavailable');
  }
}

export function previewToday(): string {
  return localDate();
}

export function accountKey(email: string): string {
  return `${ACCOUNT_PREFIX}${encodeURIComponent(email.toLowerCase())}`;
}

function getItem(key: string): string | null {
  try {
    return storage().getItem(key);
  } catch (error) {
    if (error instanceof MockApiError) throw error;
    throw new MockApiError('Your browser could not read preview data. Please try again.', 503, 'storage_unavailable');
  }
}

function setItem(key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch (error) {
    if (error instanceof MockApiError) throw error;
    throw new MockApiError('Preview changes could not be saved. Check available browser storage and try again.', 503, 'storage_unavailable');
  }
}

export function activeEmail(): string | null {
  const active = getItem(ACTIVE_KEY);
  if (active === SIGNED_OUT) return null;
  if (active) return active;
  setItem(ACTIVE_KEY, DEFAULT_PREVIEW_EMAIL);
  return DEFAULT_PREVIEW_EMAIL;
}

export function setActiveEmail(email: string | null): void {
  setItem(ACTIVE_KEY, email ?? SIGNED_OUT);
}

export function readSnapshot(email: string): AppSnapshot | null {
  const saved = getItem(accountKey(email));
  if (saved === null) return null;
  try {
    const envelope = JSON.parse(saved) as { version: unknown; snapshot: unknown };
    if (envelope.version !== 1) throw new Error('Unsupported saved preview version.');
    validateSnapshot(envelope.snapshot);
    if (envelope.snapshot.profile.email.toLowerCase() !== email.toLowerCase()) throw new Error('Preview account mismatch.');
    return envelope.snapshot;
  } catch {
    throw new MockApiError('This saved preview cannot be read. Reset the preview in account settings to restore sample data.', 409, 'invalid_saved_preview');
  }
}

export function writeSnapshot(email: string, data: AppSnapshot): void {
  validateSnapshot(data);
  if (data.profile.email.toLowerCase() !== email.toLowerCase()) throw new MockApiError('The preview account does not match these records.', 403, 'account_mismatch');
  setItem(accountKey(email), JSON.stringify({ version: 1, snapshot: data }));
}

export function clone<T>(data: T): T {
  return structuredClone(data);
}

export async function delayAndMaybeFail(operation: string): Promise<void> {
  const configuredDelay = getItem(DELAY_KEY);
  const parsedDelay = configuredDelay === null ? 100 : Number(configuredDelay);
  const delay = Number.isFinite(parsedDelay) ? Math.min(2_000, Math.max(0, parsedDelay)) : 100;
  await new Promise(resolve => setTimeout(resolve, delay));
  const failNext = getItem(FAIL_NEXT_KEY);
  if (failNext === '*' || failNext === operation) {
    try { storage().removeItem(FAIL_NEXT_KEY); } catch { /* Failure still leaves this request unapplied. */ }
    throw new MockApiError('The preview request failed. Your changes have not been saved. Please try again.', 503, 'simulated_network_error');
  }
}

/** Test hook only: matches the named TrainingClient operation or the next request. */
export function failNextMockRequest(operation = '*'): void {
  setItem(FAIL_NEXT_KEY, operation);
}

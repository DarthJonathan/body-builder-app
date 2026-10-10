export type User = {
  id: string;
  email: string;
  displayName: string;
};

export type Session = {
  token: string;
  expiresAt: string;
  user: User;
};

type APIResponse<T> = { success: boolean; error?: string; code?: string; data: T };

export class APIError extends Error {
  constructor(message: string, public status = 0, public code = '', public data: unknown = null) {
    super(message); this.name = 'APIError';
  }
  get temporary(): boolean { return this.status === 0 || [408, 429, 502, 503, 504].includes(this.status); }
}

export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, { ...options, headers, cache: 'no-store', signal: options.signal ?? AbortSignal.timeout(35_000) });
  } catch {
    throw new APIError('Cannot connect right now. Please try again when you are online.');
  }
  let result: APIResponse<T>;
  try { result = await response.json(); }
  catch { throw new APIError('The server returned an unexpected response. Please try again.', response.status); }
  if (!response.ok || !result.success) throw new APIError(result.error || 'Something went wrong. Please try again.', response.status, result.code, result.data);
  return result.data;
}

export function signIn(email: string, password: string): Promise<Session> {
  return api('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function register(displayName: string, email: string, password: string): Promise<Session> {
  return api('auth/register', { method: 'POST', body: JSON.stringify({ displayName, email, password }) });
}

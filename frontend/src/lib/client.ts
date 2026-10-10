import { createMockClient } from './mock/client';
import { createLiveClient } from './live/client';
import * as publicEnv from '$env/static/public';

export const isMockPreview = Object.entries(publicEnv as Record<string,string|undefined>).find(([name])=>name==='PUBLIC_API_MODE')?.[1]==='mock';
export const client = isMockPreview ? createMockClient() : createLiveClient();
export { syncState } from './live/client';

export { MockApiError } from './mock/errors';
export { createMockClient } from './mock/client';
export { failNextMockRequest, previewToday } from './mock/storage';

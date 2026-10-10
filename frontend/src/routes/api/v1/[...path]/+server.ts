import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';

const hopHeaders = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'
];

const handle: RequestHandler = async ({ request, params }) => {
  const base = (env.BACKEND_API_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');
  const target = new URL(`${base}/api/v1/${params.path ?? ''}`);
  target.search = new URL(request.url).search;
  const headers = new Headers(request.headers);
  for (const name of hopHeaders) headers.delete(name);
  const requestId = randomUUID();
  headers.set('x-request-id', requestId);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.timeout(45_000),
      redirect: 'manual'
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of hopHeaders) responseHeaders.delete(name);
    responseHeaders.set('cache-control', 'no-store');
    responseHeaders.set('x-request-id', requestId);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json(
      { success: false, error: 'Cannot reach the training server. Your saved data is still on this device.', requestId },
      { status: 502, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } }
    );
  }
};

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;

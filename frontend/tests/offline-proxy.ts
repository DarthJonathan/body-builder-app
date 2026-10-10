import { createServer, request, type ClientRequest } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export type OfflineProxy = {
  origin: string;
  setAvailable: (available: boolean) => void;
  close: () => Promise<void>;
};

/** A real transport boundary; service-worker fetches cannot bypass its outage. */
export async function createOfflineProxy(targetURL: string): Promise<OfflineProxy> {
  const target = new URL(targetURL);
  const sockets = new Set<Socket>();
  const upstreamRequests = new Set<ClientRequest>();
  let available = true;
  const server = createServer((incoming, outgoing) => {
    if (!available) {
      incoming.socket.destroy();
      return;
    }
    const upstream = request({
      hostname: target.hostname,
      port: target.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host, connection: 'close' },
      agent: false
    }, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
      response.on('error', () => outgoing.destroy());
    });
    upstreamRequests.add(upstream);
    upstream.on('close', () => upstreamRequests.delete(upstream));
    upstream.on('error', () => {
      if (!available || outgoing.destroyed) outgoing.destroy();
      else {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end('The test proxy could not reach the production frontend.');
      }
    });
    incoming.on('aborted', () => upstream.destroy());
    outgoing.on('close', () => { if (!outgoing.writableFinished) upstream.destroy(); });
    incoming.pipe(upstream);
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (!available) socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${address.port}`,
    setAvailable(next) {
      available = next;
      if (!next) {
        for (const socket of sockets) socket.destroy();
        for (const upstream of upstreamRequests) upstream.destroy();
      }
    },
    async close() {
      available = false;
      for (const socket of sockets) socket.destroy();
      for (const upstream of upstreamRequests) upstream.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

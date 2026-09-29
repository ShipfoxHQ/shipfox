import {once} from 'node:events';
import type {Server as HttpServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';

// The API calls each provider mock at one configured address, so specs in parallel workers
// take turns on the port: a mock waits for the previous spec's mock to stop.
const PORT_WAIT_TIMEOUT_MS = 240_000;
const PORT_RETRY_INTERVAL_MS = 100;

/** Listens on the endpoint's host and port, waiting while another mock holds the port. */
export async function listenOnEndpoint(server: HttpServer, endpoint: URL): Promise<URL> {
  const port = Number(endpoint.port);
  const deadline = Date.now() + PORT_WAIT_TIMEOUT_MS;

  while (true) {
    server.listen({host: endpoint.hostname, port});
    try {
      await once(server, 'listening');
      break;
    } catch (error) {
      if (!isAddressInUseError(error) || port === 0 || Date.now() >= deadline) throw error;
      await delay(PORT_RETRY_INTERVAL_MS);
    }
  }

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);
  return boundEndpoint;
}

export async function closeServer(server: HttpServer): Promise<void> {
  server.close();
  await once(server, 'close');
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

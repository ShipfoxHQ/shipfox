import {once} from 'node:events';
import type {Server as HttpServer} from 'node:http';

/** Listens on the endpoint's host and port, and returns the address it bound. */
export async function listenOnEndpoint(server: HttpServer, endpoint: URL): Promise<URL> {
  server.listen({host: endpoint.hostname, port: Number(endpoint.port)});
  await once(server, 'listening');

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

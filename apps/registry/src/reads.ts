import {
  ClientError,
  defineRoute,
  type FastifyReply,
  type FastifyRequest,
  type RouteDefinition,
} from '@shipfox/node-fastify';
import {isStorageKey, type RegistryStorage} from '#storage/storage.js';

const IMMUTABLE_KEY_PATTERN = /^v1\/(?:blobs\/|packages\/[^/]+\/[^/]+\/versions\/)/;

/** Serves the public `v1/` and `.well-known/` files as stored, like a CDN in front of the bucket. */
export function readRoutes(storage: RegistryStorage): RouteDefinition[] {
  return ['v1', '.well-known'].map((prefix) =>
    defineRoute({
      method: 'GET',
      path: `/${prefix}/*`,
      description: `Serve a public registry file under ${prefix}/.`,
      handler: (request, reply) => serveFile({storage, prefix, request, reply}),
    }),
  );
}

async function serveFile({
  storage,
  prefix,
  request,
  reply,
}: {
  storage: RegistryStorage;
  prefix: string;
  request: FastifyRequest;
  reply: FastifyReply;
}) {
  const key = `${prefix}/${(request.params as {'*': string})['*']}`;
  const stored = isStorageKey(key) ? await storage.get(key) : null;
  if (!stored) throw new ClientError(`No registry file at ${key}`, 'not-found', {status: 404});

  reply
    .header('etag', stored.etag)
    .header(
      'cache-control',
      IMMUTABLE_KEY_PATTERN.test(key) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  if (matchesEtag(request.headers['if-none-match'], stored.etag)) return reply.code(304).send();
  return reply
    .type(key.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream')
    .send(stored.body);
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  return header?.split(',').some((candidate) => candidate.trim() === etag) ?? false;
}

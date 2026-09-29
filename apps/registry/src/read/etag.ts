import {createHash} from 'node:crypto';
import type {FastifyReply, FastifyRequest} from '@shipfox/node-fastify';

const WEAK_PREFIX = /^W\//;

/**
 * Sends `body` with a validator taken from its content, or a bare 304 when the client already holds
 * that content. Returns the body to send, or undefined once the reply is sent.
 */
export function withEtag<Body>({
  request,
  reply,
  body,
}: {
  request: FastifyRequest;
  reply: FastifyReply;
  body: Body;
}): Body | undefined {
  const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
  reply.header('etag', etag);
  if (matchesEtag({header: request.headers['if-none-match'], etag})) {
    reply.code(304).send();
    return undefined;
  }
  return body;
}

function matchesEtag({header, etag}: {header: string | undefined; etag: string}): boolean {
  if (header === undefined) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(WEAK_PREFIX, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
}

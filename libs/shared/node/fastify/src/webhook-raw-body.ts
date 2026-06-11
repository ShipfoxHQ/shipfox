import type {Buffer} from 'node:buffer';
import type {FastifyInstance, FastifyPluginAsync} from 'fastify';
import fp from 'fastify-plugin';

const rawBodyPluginFn: FastifyPluginAsync = (scope: FastifyInstance) => {
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser(
    'application/json',
    {parseAs: 'buffer'},
    (_request, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
      done(null, body);
    },
  );
  return Promise.resolve();
};

/**
 * Webhook signatures are computed over exact bytes; JSON parsing can change key
 * order or unicode escaping before verification.
 */
export const rawBodyPlugin = fp(rawBodyPluginFn);

/**
 * Body-size cap shared by webhook receivers. Provider payloads (e.g. GitHub
 * push events) can be large, so this is intentionally generous.
 */
export const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;

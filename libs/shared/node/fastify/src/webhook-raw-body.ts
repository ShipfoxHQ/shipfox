import type {Buffer} from 'node:buffer';
import type {FastifyInstance, FastifyPluginAsync} from 'fastify';
import fp from 'fastify-plugin';

// Webhook receivers must verify HMAC signatures over the exact bytes the
// provider signed. A normal JSON parse + re-serialize can change key order or
// unicode escaping, breaking verification. This plugin replaces the
// application/json content-type parser with one that hands the handler the raw
// Buffer, so signature checks run over the bytes as received.
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
 * Fastify plugin that delivers the raw request Buffer for `application/json`
 * bodies instead of a parsed object. Register it on a webhook route group so
 * the handler can verify provider signatures over the exact received bytes.
 */
export const rawBodyPlugin = fp(rawBodyPluginFn);

/**
 * Body-size cap shared by webhook receivers. Provider payloads (e.g. GitHub
 * push events) can be large, so this is intentionally generous.
 */
export const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;

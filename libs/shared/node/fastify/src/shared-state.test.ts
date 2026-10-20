import type {FastifyReply, FastifyRequest} from 'fastify';

const SHARED_KEYS = [
  '@shipfox/node-process-state/registry/v1',
  '@shipfox/node-fastify/app/v1',
  '@shipfox/node-fastify/auth-methods/v1',
  '@shipfox/node-fastify/client-errors/v1',
];

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

async function loadCopy() {
  vi.resetModules();
  return {
    index: await import('./index.js'),
    auth: await import('./auth.js'),
    errors: await import('./errorHandler.js'),
  };
}

describe('state shared between module instances', () => {
  beforeEach(clearSharedState);
  afterEach(clearSharedState);

  it('exposes an app created through one instance to the other', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    const app = await first.index.createApp({swagger: false});

    expect(second.index.app()).toBe(app);
    await second.index.closeApp();
    expect(() => first.index.app()).toThrow('Fastify app has not been created');
  });

  it('resolves auth methods registered through the other instance', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    first.auth.registerAuthMethods([{name: 'client', authenticate: () => Promise.resolve()}]);

    expect(() => second.auth.createAuthHook('client')).not.toThrow();
  });

  it('reads a client error recorded by the other instance', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    const request = {} as FastifyRequest;
    const reply = {code: () => ({send: () => undefined})} as unknown as FastifyReply;
    const error = Object.assign(new Error('Route not found'), {code: 'FST_ERR_NOT_FOUND'});

    first.errors.errorHandler(error, request, reply);

    expect(second.errors.getClientErrorLog(request)).toEqual({
      code: 'not-found',
      message: 'Route not found',
    });
  });
});

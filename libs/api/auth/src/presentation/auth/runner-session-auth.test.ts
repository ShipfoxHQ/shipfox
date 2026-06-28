import {getRunnerSessionContext} from '@shipfox/api-auth-context';
import {RUNNER_SESSION_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {issueRunnerSessionToken} from '#core/runner-session-token.js';
import {createRunnerSessionAuthMethod} from './runner-session-auth.js';

describe('runner-session-auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const authMethod = createRunnerSessionAuthMethod();
    app.addHook('onRequest', async (request, reply) => {
      await authMethod.authenticate(request, reply);
    });

    app.get('/protected', (request) => {
      return {runnerSession: getRunnerSessionContext(request)};
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('valid session token sets runner session context on the request', async () => {
    const claims = {
      runnerSessionId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      scope: 'workspace' as const,
      labels: ['linux', 'x64'],
    };
    const token = await issueRunnerSessionToken(claims);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runnerSession).toMatchObject({
      ...claims,
      aud: RUNNER_SESSION_TOKEN_AUDIENCE,
    });
  });
});

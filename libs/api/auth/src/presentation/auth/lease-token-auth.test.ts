import {getLeasedJobContext} from '@shipfox/api-auth-context';
import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {issueJobLeaseToken} from '#core/job-lease-token.js';
import {createLeaseTokenAuthMethod} from './lease-token-auth.js';

describe('lease-token-auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const authMethod = createLeaseTokenAuthMethod();
    app.addHook('onRequest', async (request, reply) => {
      await authMethod.authenticate(request, reply);
    });

    app.get('/protected', (request) => {
      return {leasedJob: getLeasedJobContext(request)};
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('valid lease token sets leased job context on the request', async () => {
    const claims = {
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      runnerSessionId: crypto.randomUUID(),
    };
    const token = await issueJobLeaseToken(claims);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().leasedJob).toMatchObject({
      ...claims,
      aud: JOB_LEASE_TOKEN_AUDIENCE,
    });
  });
});

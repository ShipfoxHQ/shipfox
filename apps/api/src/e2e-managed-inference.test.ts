import {closeApp, createApp} from '@shipfox/node-fastify';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {createE2eManagedInferenceProvider} from './e2e-managed-inference.js';

const JOB_IDENTITY = {
  projectId: '00000000-0000-4000-8000-000000000001',
  jobId: '00000000-0000-4000-8000-000000000002',
  jobExecutionId: '00000000-0000-4000-8000-000000000003',
  stepId: '00000000-0000-4000-8000-000000000004',
  attempt: 1,
};
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

afterEach(async () => {
  await closeApp();
});

describe('E2E managed inference fixture', () => {
  it('accepts generation one for static credentials', async () => {
    const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key');
    if (fixture === undefined) throw new Error('fixture should be configured');
    const app = await createApp({
      auth: fixture.module.auth ?? [],
      routes: fixture.module.routes ?? [],
      swagger: false,
    });
    const runtimeConfig = await fixture.provider.resolveCredentials({
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'static-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-renewable-pi',
      renewableInference: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: `Bearer ${runtimeConfig.credentials.api_key}`},
      payload: {model: 'e2e-renewable-pi'},
    });

    expect(response.statusCode).toBe(200);

    const adminResponse = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: 'Bearer e2e-admin-key'},
      payload: {model: 'e2e-renewable-pi'},
    });
    expect(adminResponse.statusCode).toBe(200);
  });

  it('rejects renewable generation one and accepts the refreshed generation', async () => {
    const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key');
    if (fixture === undefined) throw new Error('fixture should be configured');
    const app = await createApp({
      auth: fixture.module.auth ?? [],
      routes: fixture.module.routes ?? [],
      swagger: false,
    });
    const first = await fixture.provider.resolveCredentials({
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'renewable-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-renewable-pi',
      renewableInference: true,
    });
    expect(first.generation).toMatch(UUID_V4_PATTERN);

    const rejected = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: `Bearer ${first.credentials.api_key}`},
      payload: {model: 'e2e-renewable-pi'},
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toEqual({error: {code: 'unauthorized'}});

    const refreshed = await fixture.provider.resolveCredentials({
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'renewable-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-renewable-pi',
      renewableInference: true,
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: `Bearer ${refreshed.credentials.api_key}`},
      payload: {model: 'e2e-renewable-pi'},
    });

    expect(accepted.statusCode).toBe(200);
  });
});

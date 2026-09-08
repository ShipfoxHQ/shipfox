import {closeApp, createApp} from '@shipfox/node-fastify';
import {afterEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
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
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('serves Claude and refresh-at credentials through the matching API route', async () => {
    const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key');
    if (fixture === undefined) throw new Error('fixture should be configured');
    const app = await createApp({
      auth: fixture.module.auth ?? [],
      routes: fixture.module.routes ?? [],
      swagger: false,
    });

    const firstClaude = await fixture.provider.resolveCredentials({
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'claude-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-renewable-claude',
      renewableInference: true,
    });
    const rejectedClaude = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/messages',
      headers: {'x-api-key': firstClaude.credentials.api_key},
      payload: {model: 'e2e-renewable-claude'},
    });
    expect(rejectedClaude.statusCode).toBe(401);
    expect(rejectedClaude.json()).toEqual({
      type: 'error',
      error: {type: 'authentication_error', message: 'unauthorized'},
    });

    const refreshedClaude = await fixture.provider.resolveCredentials({
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'claude-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-renewable-claude',
      renewableInference: true,
    });
    const acceptedClaude = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/messages',
      headers: {'x-api-key': refreshedClaude.credentials.api_key},
      payload: {model: 'e2e-renewable-claude'},
    });
    expect(acceptedClaude.statusCode).toBe(200);

    const firstRefreshAt = await fixture.provider.resolveCredentials({
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'refresh-at-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-refresh-renewable-claude',
      renewableInference: true,
    });
    if (firstRefreshAt.renewal?.mode !== 'refresh-at' || firstRefreshAt.expiresAt === undefined) {
      throw new Error('refresh-at credentials should include a renewal window');
    }
    expect(firstRefreshAt.renewal.refreshAt.getTime()).toBeLessThan(
      firstRefreshAt.expiresAt.getTime(),
    );
    const rejectedRefreshAt = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/messages',
      headers: {'x-api-key': firstRefreshAt.credentials.api_key},
      payload: {model: 'e2e-refresh-renewable-claude'},
    });
    expect(rejectedRefreshAt.statusCode).toBe(401);

    const refreshedRefreshAt = await fixture.provider.resolveCredentials({
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'refresh-at-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-refresh-renewable-claude',
      renewableInference: true,
    });
    const acceptedRefreshAt = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/messages',
      headers: {'x-api-key': refreshedRefreshAt.credentials.api_key},
      payload: {model: 'e2e-refresh-renewable-claude'},
    });
    expect(acceptedRefreshAt.statusCode).toBe(200);
  });

  it('keeps credential state bounded and excludes unissued generations from stats', async () => {
    const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key');
    if (fixture === undefined) throw new Error('fixture should be configured');
    const app = await createApp({
      auth: fixture.module.auth ?? [],
      routes: [...(fixture.module.routes ?? []), ...(fixture.module.e2eRoutes ?? [])],
      swagger: false,
    });

    let oldestToken = '';
    let newestToken = '';
    for (let index = 0; index <= 1_000; index += 1) {
      const runtimeConfig = await fixture.provider.resolveCredentials({
        workspaceId: 'workspace',
        runId: 'run',
        stepAttemptId: `bounded-step-${index}`,
        jobIdentity: JOB_IDENTITY,
        model: 'e2e-renewable-pi',
        renewableInference: false,
      });
      const token = runtimeConfig.credentials.api_key;
      if (token === undefined) throw new Error('E2E credentials should include an API key');
      if (index === 0) oldestToken = token;
      newestToken = token;
    }

    const evicted = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: `Bearer ${oldestToken}`},
      payload: {model: 'e2e-renewable-pi'},
    });
    expect(evicted.statusCode).toBe(401);

    await expect(
      Promise.resolve().then(() =>
        fixture.provider.resolveCredentials({
          workspaceId: 'workspace',
          runId: 'run',
          stepAttemptId: 'bounded-step-0',
          jobIdentity: JOB_IDENTITY,
          model: 'e2e-renewable-claude',
          renewableInference: false,
        }),
      ),
    ).rejects.toThrow('model changed during credential renewal');

    const newest = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: `Bearer ${newestToken}`},
      payload: {model: 'e2e-renewable-pi'},
    });
    expect(newest.statusCode).toBe(200);

    const before = await app.inject({method: 'GET', url: '/managed-inference/stats'});
    const unissuedGeneration = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: 'Bearer shipfox-e2e-bounded-step-1000-g999'},
      payload: {model: 'e2e-renewable-pi'},
    });
    expect(unissuedGeneration.statusCode).toBe(401);

    for (let index = 0; index < 10; index += 1) {
      const unknown = await app.inject({
        method: 'POST',
        url: '/__e2e-managed-inference/v1/chat/completions',
        headers: {authorization: `Bearer shipfox-e2e-unknown-step-${index}-g1`},
        payload: {model: 'e2e-renewable-pi'},
      });
      expect(unknown.statusCode).toBe(401);
    }
    const after = await app.inject({method: 'GET', url: '/managed-inference/stats'});
    expect(after.json().requestsByGeneration).toEqual(before.json().requestsByGeneration);
  });

  it('retains static credential state past the renewable state TTL', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
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
      stepAttemptId: 'static-retention-step',
      jobIdentity: JOB_IDENTITY,
      model: 'e2e-renewable-pi',
      renewableInference: false,
    });

    now += 600_001;
    const response = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/chat/completions',
      headers: {authorization: `Bearer ${runtimeConfig.credentials.api_key}`},
      payload: {model: 'e2e-renewable-pi'},
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects model and renewable mode changes for a credential identity', async () => {
    const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key');
    if (fixture === undefined) throw new Error('fixture should be configured');
    const credentialParams = {
      workspaceId: 'workspace',
      runId: 'run',
      stepAttemptId: 'guard-step',
      jobIdentity: JOB_IDENTITY,
    };
    await fixture.provider.resolveCredentials({
      ...credentialParams,
      model: 'e2e-renewable-pi',
      renewableInference: false,
    });

    await expect(
      Promise.resolve().then(() =>
        fixture.provider.resolveCredentials({
          ...credentialParams,
          model: 'e2e-renewable-claude',
          renewableInference: false,
        }),
      ),
    ).rejects.toThrow('model changed during credential renewal');
    await expect(
      Promise.resolve().then(() =>
        fixture.provider.resolveCredentials({
          ...credentialParams,
          model: 'e2e-renewable-pi',
          renewableInference: true,
        }),
      ),
    ).rejects.toThrow('renewable mode changed during credential renewal');
  });
});

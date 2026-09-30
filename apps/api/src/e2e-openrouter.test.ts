import {createServer, type IncomingMessage, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {inferenceSegmentInputSchema} from '@shipfox/api-usage-dto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {afterEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import {
  composeTemplate,
  extractModelAnchors,
  loadShippedTemplates,
  templateVariants,
} from '@shipfox/workflow-templates';
import {parse as parseYaml} from 'yaml';
import {createE2eManagedInferenceProvider} from './e2e-managed-inference.js';
import {OPENROUTER_MODEL_IDS} from './e2e-openrouter.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const JOB_IDENTITY = {
  projectId: PROJECT_ID,
  workflowRunAttemptId: '00000000-0000-4000-8000-000000000002',
  jobId: '00000000-0000-4000-8000-000000000003',
  jobExecutionId: '00000000-0000-4000-8000-000000000004',
  stepId: '00000000-0000-4000-8000-000000000005',
  attempt: 1,
};
const RUN_ID = '00000000-0000-4000-8000-000000000006';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000007';
const STEP_ATTEMPT_ID = '00000000-0000-4000-8000-000000000008';
const API_KEY = 'openrouter-test-key';
const COMPLETIONS_URL = '/__e2e-managed-inference/v1/chat/completions';

interface UpstreamRequest {
  authorization: string | undefined;
  body: Record<string, unknown>;
}

const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApp();
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('OpenRouter model map', () => {
  it('names an OpenRouter model for every model the provider serves as chat completions', () => {
    const fixture = createE2eManagedInferenceProvider('http://provider.test');
    if (fixture === undefined) throw new Error('fixture should be configured');

    for (const id of Object.keys(OPENROUTER_MODEL_IDS)) {
      const model = fixture.provider.models.find((candidate) => candidate.id === id);
      expect(model?.api, id).toBe('openai-completions');
    }
  });

  it('covers every model marker of every shipped template variant', () => {
    const anchoredModels = new Set<string>();
    for (const template of loadShippedTemplates()) {
      for (const {bindings, options} of templateVariants(template)) {
        const composed = composeTemplate(template, bindings, {options});
        for (const {model} of Object.values(extractModelAnchors(composed))) {
          anchoredModels.add(model);
        }
      }
    }

    expect(anchoredModels.size).toBeGreaterThan(0);
    for (const model of anchoredModels) {
      expect(Object.keys(OPENROUTER_MODEL_IDS), `${model} needs an OpenRouter model`).toContain(
        model,
      );
    }
  });

  it('finds no shipped template step on the Claude harness', () => {
    const claudeSteps: string[] = [];
    for (const template of loadShippedTemplates()) {
      for (const {bindings, options} of templateVariants(template)) {
        const composed = composeTemplate(template, bindings, {options});
        if (usesClaudeHarness(parseYaml(composed))) claudeSteps.push(template.package);
      }
    }

    expect(claudeSteps).toEqual([]);
  });
});

describe('OpenRouter backend', () => {
  it('forwards a completion with the mapped model and records its usage', async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(
        JSON.stringify({
          id: 'gen-1',
          choices: [{index: 0, message: {role: 'assistant', content: 'from openrouter'}}],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            prompt_tokens_details: {cached_tokens: 20},
            completion_tokens_details: {reasoning_tokens: 10},
          },
        }),
      );
    });
    const {app, recorded, runtime} = await startOpenRouterProject(upstream.baseUrl);

    const response = await app.inject({
      method: 'POST',
      url: COMPLETIONS_URL,
      headers: {authorization: `Bearer ${runtime.credentials.api_key}`},
      payload: {model: 'gpt-6-luna', messages: [{role: 'user', content: 'hi'}]},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0].message.content).toBe('from openrouter');
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.authorization).toBe(`Bearer ${API_KEY}`);
    expect(upstream.requests[0]?.body.model).toBe('openai/gpt-6-luna');
    expect(recorded).toHaveLength(1);
    expect(inferenceSegmentInputSchema.parse(recorded[0])).toMatchObject({
      workspaceId: WORKSPACE_ID,
      workflowRunId: RUN_ID,
      stepAttemptId: STEP_ATTEMPT_ID,
      upstream: 'openrouter',
      model: 'gpt-6-luna',
      dialect: 'openai-completions',
      requestCount: 1,
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 20,
      reasoningTokens: 10,
    });
  });

  it('streams a completion, asks for usage, and records the final usage chunk', async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write('data: {"choices":[{"index":0,"delta":{"content":"hel"}}]}\n\n');
      response.write('data: {"choices":[{"index":0,"delta":{"content":"lo"}}]}\n\n');
      response.write('data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n');
      response.end('data: [DONE]\n\n');
    });
    const {app, recorded, runtime} = await startOpenRouterProject(upstream.baseUrl);

    const response = await app.inject({
      method: 'POST',
      url: COMPLETIONS_URL,
      headers: {authorization: `Bearer ${runtime.credentials.api_key}`},
      payload: {model: 'glm-5.3-flash', stream: true, messages: [{role: 'user', content: 'hi'}]},
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"content":"hel"');
    expect(response.body).toContain('data: [DONE]');
    expect(upstream.requests[0]?.body).toMatchObject({
      model: 'z-ai/glm-5.3-flash',
      stream_options: {include_usage: true},
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({model: 'glm-5.3-flash', inputTokens: 7, outputTokens: 3});
  });

  it('sums the cost OpenRouter reports for a project, streamed or not', async () => {
    let calls = 0;
    const upstream = await startUpstream((_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(
          JSON.stringify({
            choices: [{index: 0, message: {role: 'assistant', content: 'one'}}],
            usage: {prompt_tokens: 10, completion_tokens: 5, cost: 0.0125},
          }),
        );
        return;
      }
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write('data: {"choices":[{"index":0,"delta":{"content":"two"}}]}\n\n');
      response.write(
        'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"cost":0.0075}}\n\n',
      );
      response.end('data: [DONE]\n\n');
    });
    const {app, runtime} = await startOpenRouterProject(upstream.baseUrl);
    const headers = {authorization: `Bearer ${runtime.credentials.api_key}`};

    await app.inject({
      method: 'POST',
      url: COMPLETIONS_URL,
      headers,
      payload: {model: 'gpt-6-luna', messages: []},
    });
    await app.inject({
      method: 'POST',
      url: COMPLETIONS_URL,
      headers,
      payload: {model: 'gpt-6-luna', stream: true, messages: []},
    });
    const cost = await app.inject({
      method: 'GET',
      url: `/managed-inference/openrouter/${PROJECT_ID}/cost`,
    });

    expect(upstream.requests[0]?.body.usage).toEqual({include: true});
    expect(cost.json()).toEqual({project_id: PROJECT_ID, cost_usd: 0.02, priced_requests: 2});
  });

  it('reports no cost for a project that has not called OpenRouter', async () => {
    const upstream = await startUpstream((_request, response) => response.end('{}'));
    const {app} = await startOpenRouterProject(upstream.baseUrl);

    const cost = await app.inject({
      method: 'GET',
      url: `/managed-inference/openrouter/${PROJECT_ID}/cost`,
    });

    expect(cost.json()).toEqual({project_id: PROJECT_ID, cost_usd: 0, priced_requests: 0});
  });

  it('passes an upstream error through and records no usage', async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(429, {'content-type': 'application/json'});
      response.end(JSON.stringify({error: {message: 'rate limited'}}));
    });
    const {app, recorded, runtime} = await startOpenRouterProject(upstream.baseUrl);

    const response = await app.inject({
      method: 'POST',
      url: COMPLETIONS_URL,
      headers: {authorization: `Bearer ${runtime.credentials.api_key}`},
      payload: {model: 'gpt-6-sol', stream: true, messages: []},
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.message).toBe('rate limited');
    expect(recorded).toEqual([]);
  });

  it('refuses an Anthropic request from an OpenRouter project', async () => {
    const upstream = await startUpstream((_request, response) => response.end('{}'));
    const {app, runtime} = await startOpenRouterProject(upstream.baseUrl);

    const response = await app.inject({
      method: 'POST',
      url: '/__e2e-managed-inference/v1/messages',
      headers: {authorization: `Bearer ${runtime.credentials.api_key}`},
      payload: {model: 'gpt-6-sol', messages: []},
    });

    expect(response.statusCode).toBe(400);
    expect(upstream.requests).toEqual([]);
  });

  it('rejects a model without an OpenRouter mapping', async () => {
    const upstream = await startUpstream((_request, response) => response.end('{}'));
    const {fixture} = await startOpenRouterProject(upstream.baseUrl);

    await expect(async () =>
      fixture.provider.resolveCredentials({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        stepAttemptId: '00000000-0000-4000-8000-000000000009',
        jobIdentity: JOB_IDENTITY,
        model: 'e2e-renewable-pi',
        renewableInference: false,
      }),
    ).rejects.toThrow('no OpenRouter model for e2e-renewable-pi');
  });

  it('leaves projects that did not opt in on the fixed-text backend', async () => {
    const upstream = await startUpstream((_request, response) => response.end('{}'));
    const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key', {
      openRouter: {apiKey: API_KEY, baseUrl: upstream.baseUrl},
    });
    if (fixture === undefined) throw new Error('fixture should be configured');
    const app = await createApp({
      auth: fixture.module.auth ?? [],
      routes: fixture.module.routes ?? [],
      swagger: false,
    });
    const runtime = await fixture.provider.resolveCredentials({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      stepAttemptId: STEP_ATTEMPT_ID,
      jobIdentity: JOB_IDENTITY,
      model: 'gpt-6-sol',
      renewableInference: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: COMPLETIONS_URL,
      headers: {authorization: `Bearer ${runtime.credentials.api_key}`},
      payload: {model: 'gpt-6-sol', messages: []},
    });

    expect(response.json().choices[0].message.content).toBe('ok');
    expect(upstream.requests).toEqual([]);
  });

  it('refuses to enable a project when no OpenRouter key is set', async () => {
    const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key');
    if (fixture === undefined) throw new Error('fixture should be configured');
    const app = await createApp({
      auth: fixture.module.auth ?? [],
      routes: fixture.module.e2eRoutes ?? [],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/managed-inference/openrouter',
      payload: {project_id: PROJECT_ID},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('openrouter-disabled');
  });

  it('keeps a project on one backend', async () => {
    const upstream = await startUpstream((_request, response) => response.end('{}'));
    const {app} = await startOpenRouterProject(upstream.baseUrl);

    const response = await app.inject({
      method: 'POST',
      url: '/managed-inference/scripts',
      payload: {
        project_id: PROJECT_ID,
        entries: [{match: {prompt_contains: 'x'}, replies: [{text: 'y'}]}],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('backend-conflict');
  });
});

async function startOpenRouterProject(baseUrl: string) {
  const fixture = createE2eManagedInferenceProvider('http://provider.test', 'e2e-admin-key', {
    openRouter: {apiKey: API_KEY, baseUrl},
  });
  if (fixture === undefined) throw new Error('fixture should be configured');
  const recorded: unknown[] = [];
  fixture.bindUsage({
    recordInferenceSegments: (input) => {
      recorded.push(...input.segments);
      return Promise.resolve({recorded: input.segments.length, duplicates: 0});
    },
  });
  const app = await createApp({
    auth: fixture.module.auth ?? [],
    routes: [...(fixture.module.routes ?? []), ...(fixture.module.e2eRoutes ?? [])],
    swagger: false,
  });
  const registration = await app.inject({
    method: 'POST',
    url: '/managed-inference/openrouter',
    payload: {project_id: PROJECT_ID},
  });
  expect(registration.statusCode).toBe(201);
  const runtime = await fixture.provider.resolveCredentials({
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    stepAttemptId: STEP_ATTEMPT_ID,
    jobIdentity: JOB_IDENTITY,
    model: 'gpt-6-luna',
    renewableInference: false,
  });
  expect(runtime.api).toBe('openai-completions');
  return {app, fixture, recorded, runtime};
}

async function startUpstream(
  handle: (request: IncomingMessage, response: import('node:http').ServerResponse) => void,
) {
  const requests: UpstreamRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      handle(request, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {baseUrl: `http://127.0.0.1:${port}`, requests};
}

function usesClaudeHarness(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesClaudeHarness);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => (key === 'harness' && child === 'claude') || usesClaudeHarness(child),
  );
}

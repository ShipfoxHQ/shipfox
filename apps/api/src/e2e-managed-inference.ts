import {randomUUID} from 'node:crypto';
import type {
  ManagedModelApi,
  ManagedModelProvider,
  ManagedProviderRuntimeConfig,
} from '@shipfox/api-agent-dto';
import {
  type AuthMethod,
  ClientError,
  errorHandler as defaultErrorHandler,
  defineRoute,
  type FastifyReply,
  type FastifyRequest,
  type RouteGroup,
} from '@shipfox/node-fastify';
import type {ShipfoxModule} from '@shipfox/node-module';

const E2E_MANAGED_PROVIDER_ID = 'shipfox';
const E2E_PI_MODEL = 'e2e-renewable-pi';
const E2E_CLAUDE_MODEL = 'e2e-renewable-claude';
const E2E_REFRESH_PI_MODEL = 'e2e-refresh-renewable-pi';
const E2E_REFRESH_CLAUDE_MODEL = 'e2e-refresh-renewable-claude';
const E2E_CLAUDE_MODEL_ID = 'claude-opus-4-8';
const E2E_RESPONSE_TEXT = 'ok';
const E2E_CREDENTIAL_LIFETIME_MS = 300_000;
const E2E_CREDENTIAL_STATE_TTL_MS = E2E_CREDENTIAL_LIFETIME_MS * 2;
const E2E_MAX_CREDENTIAL_STATES = 1_000;
const E2E_RENEWAL_DELAY_MS = 30_000;
const E2E_INFERENCE_ROUTE_PREFIX = '/__e2e-managed-inference';
const E2E_INFERENCE_STATS_ROUTE_PREFIX = '/managed-inference';
const E2E_MANAGED_INFERENCE_AUTH = 'e2e-managed-inference';
const TOKEN_PATTERN = /^shipfox-e2e-(.+)-g(\d+)$/u;

const E2E_MODELS = [
  {id: E2E_PI_MODEL, label: 'E2E renewable Pi', api: 'openai-completions' as const},
  {
    id: E2E_CLAUDE_MODEL,
    label: 'E2E renewable Claude',
    api: 'anthropic-messages' as const,
    claudeModelId: E2E_CLAUDE_MODEL_ID,
  },
  {
    id: E2E_REFRESH_PI_MODEL,
    label: 'E2E refresh-at Pi',
    api: 'openai-completions' as const,
  },
  {
    id: E2E_REFRESH_CLAUDE_MODEL,
    label: 'E2E refresh-at Claude',
    api: 'anthropic-messages' as const,
    claudeModelId: E2E_CLAUDE_MODEL_ID,
  },
] as const satisfies ManagedModelProvider['models'];

interface CredentialState {
  nextGeneration: number;
  model: string;
  renewableInference: boolean;
  lastTouchedAt: number;
}

interface InferenceStats {
  resolutions: number;
  expiredRequests: number;
  acceptedRequests: number;
  resolutionsByModel: Record<string, number>;
  requestsByGeneration: Record<string, number>;
  requestsByModelAndGeneration: Record<string, Record<string, number>>;
}

interface InferenceState {
  readonly credentials: Map<string, CredentialState>;
  readonly stats: InferenceStats;
}

export function createE2eManagedInferenceProvider(
  baseUrl: string | undefined,
  adminApiKey?: string,
): {provider: ManagedModelProvider; module: ShipfoxModule} | undefined {
  if (baseUrl === undefined) return undefined;

  const state: InferenceState = {
    credentials: new Map(),
    stats: {
      resolutions: 0,
      expiredRequests: 0,
      acceptedRequests: 0,
      resolutionsByModel: {},
      requestsByGeneration: {},
      requestsByModelAndGeneration: {},
    },
  };

  const provider: ManagedModelProvider = {
    id: E2E_MANAGED_PROVIDER_ID,
    label: 'Shipfox E2E managed provider',
    models: E2E_MODELS,
    defaultModel: E2E_PI_MODEL,
    defaultThinking: 'low',
    resolveCredentials: (params) => {
      if (params.jobIdentity === undefined) {
        throw new Error('E2E managed provider requires the leased job identity');
      }

      const model = E2E_MODELS.find((candidate) => candidate.id === params.model);
      if (model === undefined) {
        throw new Error(`E2E managed provider does not know model ${params.model}`);
      }

      const key = params.stepAttemptId;
      const now = Date.now();
      pruneCredentialStates(state, now);
      const renewableInference = params.renewableInference === true;
      const credentialState = state.credentials.get(key) ?? {
        nextGeneration: 1,
        model: model.id,
        renewableInference,
        lastTouchedAt: now,
      };
      if (credentialState.model !== model.id) {
        throw new Error('E2E managed provider model changed during credential renewal');
      }
      if (credentialState.renewableInference !== renewableInference) {
        throw new Error('E2E managed provider renewable mode changed during credential renewal');
      }
      const generation = credentialState.nextGeneration;
      credentialState.nextGeneration += 1;
      credentialState.lastTouchedAt = now;
      state.credentials.set(key, credentialState);
      state.stats.resolutions += 1;
      state.stats.resolutionsByModel[model.id] =
        (state.stats.resolutionsByModel[model.id] ?? 0) + 1;

      const token = `shipfox-e2e-${params.stepAttemptId}-g${generation}`;
      const runtimeConfig: ManagedProviderRuntimeConfig = {
        api: model.api,
        baseUrl,
        credentials: {api_key: token},
      };
      if (!renewableInference) return Promise.resolve(runtimeConfig);

      return Promise.resolve({
        ...runtimeConfig,
        expiresAt: new Date(now + E2E_CREDENTIAL_LIFETIME_MS),
        generation: randomUUID(),
        renewal: {
          mode: 'refresh-at',
          refreshAt: new Date(
            now + (isRefreshAtModel(model.id) && generation === 1 ? -1_000 : E2E_RENEWAL_DELAY_MS),
          ),
        },
      });
    },
  };

  return {
    provider,
    module: {
      name: 'e2e-managed-inference',
      auth: [createInferenceAuth(state, adminApiKey)],
      routes: [createInferenceRoutes(state, adminApiKey)],
      e2eRoutes: [createInferenceStatsRoutes(state)],
    },
  };
}

function createInferenceRoutes(state: InferenceState, adminApiKey: string | undefined): RouteGroup {
  return {
    prefix: E2E_INFERENCE_ROUTE_PREFIX,
    auth: E2E_MANAGED_INFERENCE_AUTH,
    routes: [
      defineRoute({
        method: 'POST',
        path: '/v1/chat/completions',
        description: 'Serves the scripted OpenAI-compatible E2E managed inference response.',
        errorHandler: inferenceAuthenticationErrorHandler,
        handler: (request, reply) =>
          respondToInferenceRequest({
            api: 'openai-completions',
            body: request.body,
            headers: request.headers,
            adminApiKey,
            reply,
            state,
          }),
      }),
      defineRoute({
        method: 'POST',
        path: '/v1/messages',
        description: 'Serves the scripted Anthropic-compatible E2E managed inference response.',
        errorHandler: inferenceAuthenticationErrorHandler,
        handler: (request, reply) =>
          respondToInferenceRequest({
            api: 'anthropic-messages',
            body: request.body,
            headers: request.headers,
            adminApiKey,
            reply,
            state,
          }),
      }),
    ],
  };
}

function createInferenceStatsRoutes(state: InferenceState): RouteGroup {
  return {
    prefix: E2E_INFERENCE_STATS_ROUTE_PREFIX,
    routes: [
      defineRoute({
        method: 'GET',
        path: '/stats',
        description: 'Returns non-secret E2E managed inference fixture counters.',
        handler: () => state.stats,
      }),
    ],
  };
}

function createInferenceAuth(state: InferenceState, adminApiKey: string | undefined): AuthMethod {
  return {
    name: E2E_MANAGED_INFERENCE_AUTH,
    authenticate: (request) => {
      const token = requestToken(request.headers);
      if (token === undefined) {
        throw new ClientError('Missing credential', 'unauthorized', {status: 401});
      }
      if (adminApiKey !== undefined && token === adminApiKey) return Promise.resolve();

      const tokenDetails = parseToken(token);
      const credentialState =
        tokenDetails === undefined
          ? undefined
          : currentCredentialState(state, tokenDetails.stepAttemptId);
      const credential = {tokenDetails, credentialState};
      if (!isCurrentCredential(credential)) {
        state.stats.expiredRequests += 1;
        if (credential.tokenDetails !== undefined) {
          recordGeneration(
            state,
            credential.tokenDetails.generation,
            credential.credentialState?.model,
          );
        }
        throw new ClientError('Expired credential', 'unauthorized', {status: 401});
      }
      return Promise.resolve();
    },
  };
}

function inferenceAuthenticationErrorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  if (!(error instanceof ClientError) || error.code !== 'unauthorized') {
    return defaultErrorHandler(error, request, reply);
  }

  if (request.url.includes('/v1/messages')) {
    return reply.code(401).send({
      type: 'error',
      error: {type: 'authentication_error', message: 'unauthorized'},
    });
  }
  return reply.code(401).send({error: {code: 'unauthorized'}});
}

function respondToInferenceRequest(params: {
  api: ManagedModelApi;
  body: unknown;
  headers: Record<string, unknown>;
  adminApiKey: string | undefined;
  reply: {
    code(statusCode: number): {send(payload: unknown): unknown};
    header(name: string, value: string): unknown;
    hijack(): unknown;
    raw: {
      end(chunk?: string): unknown;
      write(chunk: string): unknown;
      writeHead(statusCode: number, headers: Record<string, string>): unknown;
    };
    send(payload: unknown): unknown;
  };
  state: InferenceState;
}): unknown {
  const token = requestToken(params.headers);
  const tokenDetails = parseToken(token);
  const requestModel = bodyString(params.body, 'model') ?? 'unknown';
  if (token === undefined) {
    return params.reply.code(401).send({code: 'unauthorized', message: 'missing credential'});
  }
  if (params.adminApiKey !== undefined && token === params.adminApiKey) {
    params.state.stats.acceptedRequests += 1;
    if (params.api === 'openai-completions') {
      return respondWithOpenAiCompletion(params.reply, requestModel, params.body);
    }
    return respondWithAnthropicMessage(params.reply, requestModel, params.body);
  }
  const credentialState =
    tokenDetails === undefined
      ? undefined
      : currentCredentialState(params.state, tokenDetails.stepAttemptId);
  const credential = {tokenDetails, credentialState};
  if (!isCurrentCredential(credential)) {
    params.state.stats.expiredRequests += 1;
    if (credential.tokenDetails !== undefined) {
      recordGeneration(
        params.state,
        credential.tokenDetails.generation,
        credential.credentialState?.model,
      );
    }
    return params.reply.code(401).send({code: 'unauthorized', message: 'expired'});
  }

  params.state.stats.acceptedRequests += 1;
  recordGeneration(
    params.state,
    credential.tokenDetails.generation,
    credential.credentialState.model,
  );
  if (params.api === 'openai-completions') {
    return respondWithOpenAiCompletion(params.reply, requestModel, params.body);
  }
  return respondWithAnthropicMessage(params.reply, requestModel, params.body);
}

function respondWithOpenAiCompletion(
  reply: {
    hijack(): unknown;
    raw: {
      end(chunk?: string): unknown;
      write(chunk: string): unknown;
      writeHead(statusCode: number, headers: Record<string, string>): unknown;
    };
    send(payload: unknown): unknown;
  },
  model: string,
  body: unknown,
): unknown {
  const completion = {
    id: `chatcmpl-e2e-${model}`,
    object: 'chat.completion' as const,
    created: 1_783_344_000,
    model,
    choices: [
      {
        index: 0,
        message: {role: 'assistant' as const, content: E2E_RESPONSE_TEXT},
        finish_reason: 'stop' as const,
      },
    ],
    usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
  };
  if (!bodyBoolean(body, 'stream')) return reply.send(completion);

  reply.hijack();
  reply.raw.writeHead(200, {
    'cache-control': 'no-cache',
    'content-type': 'text/event-stream; charset=utf-8',
  });
  const base = {
    id: completion.id,
    object: 'chat.completion.chunk' as const,
    created: completion.created,
    model,
  };
  reply.raw.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [
        {
          index: 0,
          delta: {role: 'assistant', content: E2E_RESPONSE_TEXT},
          finish_reason: null,
        },
      ],
    })}\n\n`,
  );
  reply.raw.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
    })}\n\n`,
  );
  return reply.raw.end('data: [DONE]\n\n');
}

function respondWithAnthropicMessage(
  reply: {
    hijack(): unknown;
    raw: {
      end(chunk?: string): unknown;
      write(chunk: string): unknown;
      writeHead(statusCode: number, headers: Record<string, string>): unknown;
    };
    send(payload: unknown): unknown;
  },
  model: string,
  body: unknown,
): unknown {
  const message = {
    id: `msg-e2e-${model}`,
    type: 'message' as const,
    role: 'assistant' as const,
    model,
    content: [{type: 'text' as const, text: E2E_RESPONSE_TEXT}],
    stop_reason: 'end_turn' as const,
    stop_sequence: null,
    usage: {input_tokens: 1, output_tokens: 1},
  };
  if (!bodyBoolean(body, 'stream')) return reply.send(message);

  reply.hijack();
  reply.raw.writeHead(200, {
    'cache-control': 'no-cache',
    'content-type': 'text/event-stream; charset=utf-8',
  });
  const events = [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          ...message,
          content: [],
          stop_reason: null,
          usage: {input_tokens: 1, output_tokens: 0},
        },
      },
    },
    {
      event: 'content_block_start',
      data: {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: {type: 'text_delta', text: E2E_RESPONSE_TEXT},
      },
    },
    {event: 'content_block_stop', data: {type: 'content_block_stop', index: 0}},
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: {stop_reason: 'end_turn', stop_sequence: null},
        usage: {output_tokens: 1},
      },
    },
    {event: 'message_stop', data: {type: 'message_stop'}},
  ];
  for (const event of events) {
    reply.raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }
  return reply.raw.end();
}

function requestToken(headers: Record<string, unknown>): string | undefined {
  const authorization = headerValue(headers.authorization);
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
  return headerValue(headers['x-api-key']);
}

function parseToken(
  token: string | undefined,
): {stepAttemptId: string; generation: number} | undefined {
  const match = token === undefined ? undefined : TOKEN_PATTERN.exec(token);
  if (match === null || match === undefined) return undefined;
  const stepAttemptId = match[1];
  const rawGeneration = match[2];
  if (stepAttemptId === undefined || rawGeneration === undefined) return undefined;
  const generation = Number(rawGeneration);
  return stepAttemptId.length > 0 && Number.isSafeInteger(generation) && generation > 0
    ? {stepAttemptId, generation}
    : undefined;
}

function currentCredentialState(
  state: InferenceState,
  stepAttemptId: string,
): CredentialState | undefined {
  const now = Date.now();
  pruneCredentialStates(state, now);
  const credentialState = state.credentials.get(stepAttemptId);
  if (credentialState !== undefined) credentialState.lastTouchedAt = now;
  return credentialState;
}

interface CredentialCandidate {
  tokenDetails: {generation: number} | undefined;
  credentialState: CredentialState | undefined;
}

interface CurrentCredentialCandidate {
  tokenDetails: {generation: number};
  credentialState: CredentialState;
}

function isCurrentCredential(
  credential: CredentialCandidate,
): credential is CurrentCredentialCandidate {
  const {tokenDetails, credentialState} = credential;
  return (
    tokenDetails !== undefined &&
    credentialState !== undefined &&
    tokenDetails.generation === credentialState.nextGeneration - 1 &&
    (!credentialState.renewableInference || tokenDetails.generation !== 1)
  );
}

function headerValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function bodyString(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function bodyBoolean(body: unknown, key: string): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as Record<string, unknown>)[key] === true;
}

function recordGeneration(
  state: InferenceState,
  generation: number,
  model: string | undefined,
): void {
  const key = String(generation);
  state.stats.requestsByGeneration[key] = (state.stats.requestsByGeneration[key] ?? 0) + 1;
  if (model === undefined) return;

  const requestsByGeneration = state.stats.requestsByModelAndGeneration[model] ?? {};
  state.stats.requestsByModelAndGeneration[model] = requestsByGeneration;
  requestsByGeneration[key] = (requestsByGeneration[key] ?? 0) + 1;
}

function pruneCredentialStates(state: InferenceState, now: number): void {
  for (const [key, credentialState] of state.credentials) {
    if (now - credentialState.lastTouchedAt > E2E_CREDENTIAL_STATE_TTL_MS) {
      state.credentials.delete(key);
    }
  }

  while (state.credentials.size > E2E_MAX_CREDENTIAL_STATES) {
    let oldestKey: string | undefined;
    let oldestTouchedAt = Number.POSITIVE_INFINITY;
    for (const [key, credentialState] of state.credentials) {
      if (credentialState.lastTouchedAt < oldestTouchedAt) {
        oldestKey = key;
        oldestTouchedAt = credentialState.lastTouchedAt;
      }
    }
    if (oldestKey === undefined) return;
    state.credentials.delete(oldestKey);
  }
}

function isRefreshAtModel(model: string): boolean {
  return model === E2E_REFRESH_PI_MODEL || model === E2E_REFRESH_CLAUDE_MODEL;
}

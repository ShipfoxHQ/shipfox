import {configureApiClient} from '@shipfox/client-api';
import {
  AGENT_TEST_WORKSPACE_ID,
  modelProviderCatalogResponse,
  modelProviderConfig,
  modelProviderConfigsResponse,
} from '#test/fixtures/model-providers.js';
import {
  deleteModelProviderConfig,
  getModelProviderCatalog,
  listModelProviderConfigs,
  setDefaultModelProvider,
  updateModelProviderDefaultModel,
  upsertModelProviderConfig,
} from './model-providers.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('model provider transport', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('fetches the model provider catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse()));
    configureApiClient({fetchImpl});

    const result = await getModelProviderCatalog();

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.providers[0]?.label).toBe('Anthropic');
    expect(request.url).toBe('https://api.example.test/agent/model-provider-catalog');
    expect(request.method).toBe('GET');
  });

  test('fetches workspace model provider configs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(modelProviderConfigsResponse()));
    configureApiClient({fetchImpl});

    const result = await listModelProviderConfigs({workspaceId: AGENT_TEST_WORKSPACE_ID});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.default_provider_id).toBe('anthropic');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers`,
    );
    expect(request.method).toBe('GET');
  });

  test('puts model provider credentials', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(modelProviderConfig(), {status: 201});
    });
    configureApiClient({fetchImpl});
    const body = {default_model: 'claude-haiku-4-5', credentials: {api_key: 'sk-ant-secret'}};

    const result = await upsertModelProviderConfig({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
      body,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.key_fingerprints['credential:api_key']).toBe('sk-ant-s...abcd');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/anthropic`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual(body);
  });

  test('deletes model provider credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({fetchImpl});

    const result = await deleteModelProviderConfig({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result).toBeUndefined();
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/anthropic`,
    );
    expect(request.method).toBe('DELETE');
  });

  test('puts a model provider default model without credentials', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(modelProviderConfig({default_model: null}));
    });
    configureApiClient({fetchImpl});
    const body = {default_model: null};

    const result = await updateModelProviderDefaultModel({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
      body,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.default_model).toBeNull();
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/anthropic/default-model`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual(body);
  });

  test('sets the default model provider', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({default_provider_id: 'anthropic'});
    });
    configureApiClient({fetchImpl});
    const body = {provider_id: 'anthropic'} as const;

    const result = await setDefaultModelProvider({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      body,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.default_provider_id).toBe('anthropic');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/default-model-provider`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual(body);
  });
});

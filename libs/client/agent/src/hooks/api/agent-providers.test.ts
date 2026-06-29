import {configureApiClient} from '@shipfox/client-api';
import {
  AGENT_TEST_WORKSPACE_ID,
  agentProviderCatalogResponse,
  agentProviderConfig,
  agentProviderConfigsResponse,
} from '#test/fixtures/agent-providers.js';
import {
  deleteAgentProviderConfig,
  getAgentProviderCatalog,
  listAgentProviderConfigs,
  setDefaultAgentProvider,
  updateAgentProviderDefaultModel,
  upsertAgentProviderConfig,
} from './agent-providers.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('agent provider transport', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('fetches the provider catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(agentProviderCatalogResponse()));
    configureApiClient({fetchImpl});

    const result = await getAgentProviderCatalog();

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.providers[0]?.label).toBe('Anthropic');
    expect(request.url).toBe('https://api.example.test/agent/provider-catalog');
    expect(request.method).toBe('GET');
  });

  test('fetches workspace provider configs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(agentProviderConfigsResponse()));
    configureApiClient({fetchImpl});

    const result = await listAgentProviderConfigs({workspaceId: AGENT_TEST_WORKSPACE_ID});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.default_provider_id).toBe('anthropic');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/providers`,
    );
    expect(request.method).toBe('GET');
  });

  test('puts provider credentials', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(agentProviderConfig(), {status: 201});
    });
    configureApiClient({fetchImpl});
    const body = {default_model: 'claude-haiku-4-5', credentials: {api_key: 'sk-ant-secret'}};

    const result = await upsertAgentProviderConfig({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
      body,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.key_fingerprints.api_key).toBe('sk-ant-s...abcd');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/providers/anthropic`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual(body);
  });

  test('deletes provider credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({fetchImpl});

    const result = await deleteAgentProviderConfig({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result).toBeUndefined();
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/providers/anthropic`,
    );
    expect(request.method).toBe('DELETE');
  });

  test('puts a provider default model without credentials', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(agentProviderConfig({default_model: null}));
    });
    configureApiClient({fetchImpl});
    const body = {default_model: null};

    const result = await updateAgentProviderDefaultModel({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
      body,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.default_model).toBeNull();
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/providers/anthropic/default-model`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual(body);
  });

  test('sets the default provider', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({default_provider_id: 'anthropic'});
    });
    configureApiClient({fetchImpl});
    const body = {provider_id: 'anthropic'} as const;

    const result = await setDefaultAgentProvider({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      body,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.default_provider_id).toBe('anthropic');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/default-provider`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual(body);
  });
});

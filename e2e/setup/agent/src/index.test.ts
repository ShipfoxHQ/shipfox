import {afterEach, beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

const createApiClient = vi.fn();
const requestJson = vi.fn();
const workspaceId = '11111111-1111-4111-8111-111111111111';
const sessionToken = 'user-session-token';

describe('agent e2e helper', () => {
  beforeEach(() => {
    vi.resetModules();
    createApiClient.mockReset();
    requestJson.mockReset();
    createApiClient.mockReturnValue({requestJson});
    vi.doMock('@shipfox/e2e-core', () => ({createApiClient, requestJson}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves Ollama defaults and appends the OpenAI-compatible path', async () => {
    const {ollamaConfig} = await import('./index.js');

    const config = ollamaConfig({});

    expect(config).toEqual({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'smollm2:135m-instruct-q2_K',
      openAiBaseUrl: 'http://127.0.0.1:11434/v1',
    });
  });

  it('prefers OLLAMA_BASE_URL over SHIPFOX_OLLAMA_BASE_URL and trims trailing slashes', async () => {
    const {ollamaConfig} = await import('./index.js');

    const config = ollamaConfig({
      OLLAMA_BASE_URL: 'http://127.0.0.1:11500///',
      SHIPFOX_OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      SHIPFOX_OLLAMA_MODEL: 'custom:model',
    });

    expect(config).toEqual({
      baseUrl: 'http://127.0.0.1:11500',
      model: 'custom:model',
      openAiBaseUrl: 'http://127.0.0.1:11500/v1',
    });
  });

  it('passes when Ollama exposes the configured model', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({models: [{name: 'smollm2:135m-instruct-q2_K'}]}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const {requireOllamaModel} = await import('./index.js');

    const result = await requireOllamaModel({fetch});

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags');
    expect(result.model).toBe('smollm2:135m-instruct-q2_K');
  });

  it('fails clearly when Ollama is unavailable', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const {requireOllamaModel} = await import('./index.js');

    await expect(requireOllamaModel({fetch})).rejects.toThrow(
      'Run `mise run ollama:up` before running agent E2E tests.',
    );
  });

  it('fails clearly when the configured model is missing', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({models: [{name: 'llama3.2:1b'}]}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const {requireOllamaModel} = await import('./index.js');

    await expect(
      requireOllamaModel({fetch, model: 'smollm2:135m-instruct-q2_K'}),
    ).rejects.toThrow('Available models: llama3.2:1b.');
  });

  it('creates a local Ollama custom provider through the product route', async () => {
    requestJson.mockResolvedValueOnce({provider_id: 'local-ollama-e2e'});
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({models: [{name: 'smollm2:135m-instruct-q2_K'}]}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const {createOllamaCustomProvider} = await import('./index.js');

    await createOllamaCustomProvider({
      workspaceId,
      sessionToken,
      providerId: 'local-ollama-e2e',
      displayName: 'Local Ollama E2E',
    });

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags');
    expect(createApiClient).toHaveBeenCalledWith({token: sessionToken});
    expect(requestJson).toHaveBeenCalledWith(
      'post',
      `/workspaces/${workspaceId}/agent/custom-model-providers`,
      {
        json: {
          slug: 'local-ollama-e2e',
          display_name: 'Local Ollama E2E',
          api: 'openai-completions',
          base_url: 'http://127.0.0.1:11434/v1',
          models: [
            {id: 'smollm2:135m-instruct-q2_K', label: 'smollm2:135m-instruct-q2_K'},
          ],
          default_model: 'smollm2:135m-instruct-q2_K',
        },
      },
    );
  });

  it('creates an OpenAI-compatible custom provider without probing Ollama', async () => {
    requestJson.mockResolvedValueOnce({provider_id: 'fake-openai-provider'});
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const {createOpenAiCompatibleCustomProvider} = await import('./index.js');

    await createOpenAiCompatibleCustomProvider({
      workspaceId,
      sessionToken,
      providerId: 'fake-openai-provider',
      displayName: 'Deterministic Agent Provider',
      baseUrl: 'http://127.0.0.1:9000/scripts/run-1/v1',
      model: 'deterministic-output-agent',
      modelMetadata: {max_output_tokens: 512},
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(createApiClient).toHaveBeenCalledWith({token: sessionToken});
    expect(requestJson).toHaveBeenCalledWith(
      'post',
      `/workspaces/${workspaceId}/agent/custom-model-providers`,
      {
        json: {
          slug: 'fake-openai-provider',
          display_name: 'Deterministic Agent Provider',
          api: 'openai-completions',
          base_url: 'http://127.0.0.1:9000/scripts/run-1/v1',
          models: [
            {
              id: 'deterministic-output-agent',
              label: 'deterministic-output-agent',
              max_output_tokens: 512,
            },
          ],
          default_model: 'deterministic-output-agent',
        },
      },
    );
  });

  it('exposes the OpenAI-compatible custom provider helper through the fixture helper', async () => {
    const {createAgentHelper, createOpenAiCompatibleCustomProvider} = await import('./index.js');

    const helper = createAgentHelper();

    expect(helper.createOpenAiCompatibleCustomProvider).toBe(createOpenAiCompatibleCustomProvider);
  });

  it('deletes a model provider config through the product route', async () => {
    requestJson.mockResolvedValueOnce(undefined);
    const {deleteModelProviderConfig} = await import('./index.js');

    await deleteModelProviderConfig({
      workspaceId,
      sessionToken,
      providerId: 'local-ollama-e2e',
    });

    expect(createApiClient).toHaveBeenCalledWith({token: sessionToken});
    expect(requestJson).toHaveBeenCalledWith(
      'delete',
      `/workspaces/${workspaceId}/agent/model-providers/local-ollama-e2e`,
    );
  });

  it('lists model provider configs through the product route', async () => {
    requestJson.mockResolvedValueOnce({configs: [], default_provider_id: null});
    const {listModelProviderConfigs} = await import('./index.js');

    await listModelProviderConfigs({workspaceId, sessionToken});

    expect(createApiClient).toHaveBeenCalledWith({token: sessionToken});
    expect(requestJson).toHaveBeenCalledWith(
      'get',
      `/workspaces/${workspaceId}/agent/model-providers`,
    );
  });

  it('creates an Anthropic model provider config through the E2E route', async () => {
    const {createAnthropicModelProviderConfig} = await import('./index.js');

    await createAnthropicModelProviderConfig({
      workspaceId,
      defaultModel: 'claude-opus-4-8',
      setAsDefault: true,
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/agent/model-provider', {
      json: {
        workspace_id: workspaceId,
        provider_id: 'anthropic',
        api_key: 'sk-e2e-anthropic-placeholder',
        default_model: 'claude-opus-4-8',
        set_as_default: true,
      },
    });
  });
});

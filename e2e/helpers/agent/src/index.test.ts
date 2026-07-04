import {afterEach, beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

const requestJson = vi.fn();
const workspaceId = '11111111-1111-4111-8111-111111111111';
const sessionToken = 'user-session-token';

describe('agent e2e helper', () => {
  beforeEach(() => {
    vi.resetModules();
    requestJson.mockReset();
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves Ollama defaults and appends the OpenAI-compatible path', async () => {
    const {ollamaConfig} = await import('./index.js');

    const config = ollamaConfig({});

    expect(config).toEqual({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3.5:0.8b',
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
      new Response(JSON.stringify({models: [{name: 'qwen3.5:0.8b'}]}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const {requireOllamaModel} = await import('./index.js');

    const result = await requireOllamaModel({fetch});

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags');
    expect(result.model).toBe('qwen3.5:0.8b');
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

    await expect(requireOllamaModel({fetch, model: 'qwen3.5:0.8b'})).rejects.toThrow(
      'Available models: llama3.2:1b.',
    );
  });

  it('creates a local Ollama custom provider through the product route', async () => {
    requestJson.mockResolvedValueOnce({provider_id: 'local-ollama-e2e'});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({models: [{name: 'qwen3.5:0.8b'}]}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        }),
      ),
    );
    const {createOllamaCustomProvider} = await import('./index.js');

    await createOllamaCustomProvider({
      workspaceId,
      sessionToken,
      providerId: 'local-ollama-e2e',
      displayName: 'Local Ollama E2E',
    });

    expect(requestJson).toHaveBeenCalledWith(
      'post',
      `/workspaces/${workspaceId}/agent/custom-model-providers`,
      {
        headers: {authorization: `Bearer ${sessionToken}`},
        json: {
          slug: 'local-ollama-e2e',
          display_name: 'Local Ollama E2E',
          api: 'openai-completions',
          base_url: 'http://127.0.0.1:11434/v1',
          models: [{id: 'qwen3.5:0.8b', label: 'qwen3.5:0.8b'}],
          default_model: 'qwen3.5:0.8b',
        },
      },
    );
  });

  it('lists model provider configs through the product route', async () => {
    requestJson.mockResolvedValueOnce({configs: [], default_provider_id: null});
    const {listModelProviderConfigs} = await import('./index.js');

    await listModelProviderConfigs({workspaceId, sessionToken});

    expect(requestJson).toHaveBeenCalledWith(
      'get',
      `/workspaces/${workspaceId}/agent/model-providers`,
      {
        headers: {authorization: `Bearer ${sessionToken}`},
      },
    );
  });
});

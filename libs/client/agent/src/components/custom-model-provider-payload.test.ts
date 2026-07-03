import type {CustomModelProviderConfigDto} from '@shipfox/api-agent-dto';
import {
  buildCreateCustomModelProviderBody,
  buildDiscoverModelsBody,
  buildDiscoverModelsBySlugBody,
  buildUpdateCustomModelProviderBody,
  customHeadersDirty,
  customModelsDirty,
  editCustomModelProviderFormValues,
  formatBaseUrlHost,
} from './custom-model-provider-payload.js';

describe('custom model provider payload mappers', () => {
  test('builds create bodies from complete form rows and filters blanks', () => {
    const body = buildCreateCustomModelProviderBody({
      slug: ' local-vllm ',
      display_name: ' Local vLLM ',
      api: 'openai-completions',
      base_url: ' http://localhost:8000/v1 ',
      api_key: ' sk-local ',
      headers: [
        {
          client_id: 'header-1',
          name: ' Authorization ',
          value: ' Bearer token ',
          secret: true,
          hasStoredValue: false,
          storedName: '',
        },
        {
          client_id: 'header-2',
          name: '',
          value: '',
          secret: false,
          hasStoredValue: false,
          storedName: '',
        },
      ],
      models: [
        {
          client_id: 'model-1',
          id: ' llama-3.1 ',
          label: ' Llama 3.1 ',
          context_window: '128000',
          max_output_tokens: '16384',
          input_image: true,
          reasoning: false,
        },
        {
          client_id: 'model-2',
          id: '',
          label: '',
          context_window: '',
          max_output_tokens: '',
          input_image: false,
          reasoning: false,
        },
      ],
      default_model: ' llama-3.1 ',
    });

    expect(body).toEqual({
      slug: 'local-vllm',
      display_name: 'Local vLLM',
      api: 'openai-completions',
      base_url: 'http://localhost:8000/v1',
      api_key: 'sk-local',
      headers: [{name: 'authorization', value: 'Bearer token', secret: true}],
      models: [
        {
          id: 'llama-3.1',
          label: 'Llama 3.1',
          context_window: 128000,
          max_output_tokens: 16384,
          input_image: true,
        },
      ],
      default_model: 'llama-3.1',
    });
  });

  test('keeps unchanged stored secret headers out of update bodies', () => {
    const config = customConfig();
    const values = editCustomModelProviderFormValues(config);

    const body = buildUpdateCustomModelProviderBody(config, values);

    expect(customHeadersDirty(config, values.headers)).toBe(false);
    expect(customModelsDirty(config, values.models)).toBe(false);
    expect(body).toEqual({});
  });

  test('serializes kept secret headers for slug-scoped discovery', () => {
    const config = customConfig();
    const values = editCustomModelProviderFormValues(config);

    const body = buildDiscoverModelsBySlugBody(config, values);

    expect(body).toEqual({
      headers: [
        {name: 'x-region', value: 'us', secret: false},
        {name: 'authorization', secret: true, keep: true},
      ],
    });
  });

  test('requires secret values again when stored secret headers are renamed', () => {
    const config = customConfig();
    const values = editCustomModelProviderFormValues(config);
    values.headers = values.headers.map((header) =>
      header.secret ? {...header, name: 'x-authorization'} : header,
    );

    const body = buildUpdateCustomModelProviderBody(config, values);

    expect(body.headers).toEqual([
      {name: 'x-region', value: 'us', secret: false},
      {name: 'x-authorization', value: '', secret: true},
    ]);
  });

  test('builds unsaved discovery bodies without keep markers', () => {
    const config = customConfig();
    const values = editCustomModelProviderFormValues(config);
    values.api_key = 'sk-new';
    values.headers = values.headers.map((header) =>
      header.secret ? {...header, value: 'Bearer new'} : header,
    );

    const body = buildDiscoverModelsBody(values);

    expect(body).toEqual({
      api: 'openai-responses',
      base_url: 'https://llm.example.test/v1',
      api_key: 'sk-new',
      headers: [
        {name: 'x-region', value: 'us'},
        {name: 'authorization', value: 'Bearer new'},
      ],
    });
  });

  test('formats valid base URL hosts and falls back for raw values', () => {
    expect(formatBaseUrlHost('https://llm.example.test/v1')).toBe('llm.example.test');
    expect(formatBaseUrlHost('not a url')).toBe('not a url');
  });
});

function customConfig(): CustomModelProviderConfigDto {
  return {
    kind: 'custom',
    provider_id: 'local-vllm',
    display_name: 'Local vLLM',
    api: 'openai-responses',
    base_url: 'https://llm.example.test/v1',
    headers: [{name: 'x-region', value: 'us'}],
    secret_header_names: ['authorization'],
    models: [
      {
        id: 'llama-3.1',
        label: 'Llama 3.1',
        context_window: 128000,
        max_output_tokens: 16384,
      },
    ],
    default_model: 'llama-3.1',
    key_fingerprints: {
      'credential:api_key': '...abcd',
      'header:authorization': '...oken',
    },
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
  };
}

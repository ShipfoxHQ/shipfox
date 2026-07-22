import {type ManagementModal, managementModalReducer} from './model-provider-management-reducer.js';
import type {BuiltinProviderConfig, CustomProviderConfig, SupportedProvider} from './models.js';

const provider: SupportedProvider = {
  kind: 'supported',
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-sonnet-4-5',
  credentialFields: [],
  models: [],
};

const builtinConfig: BuiltinProviderConfig = {
  kind: 'builtin',
  providerId: 'anthropic',
  defaultModel: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const customConfig: CustomProviderConfig = {
  kind: 'custom',
  providerId: 'local',
  displayName: 'Local',
  api: 'openai-completions',
  baseUrl: 'https://example.test/v1',
  headers: [],
  secretHeaderNames: [],
  models: [],
  defaultModel: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('managementModalReducer', () => {
  test('always replaces the current modal with one valid mode', () => {
    const initial: ManagementModal = {kind: 'configure-builtin', provider};

    const state = managementModalReducer(initial, {type: 'edit-custom', config: customConfig});

    expect(state).toEqual({kind: 'edit-custom', config: customConfig});
  });

  test.each([
    {type: 'close'} as const,
    {type: 'configure-builtin', provider} as const,
    {type: 'edit-builtin', provider, config: builtinConfig} as const,
    {type: 'change-default-model', provider, config: builtinConfig} as const,
    {type: 'create-custom'} as const,
    {type: 'edit-custom', config: customConfig} as const,
    {type: 'show-usage', providerId: 'anthropic', initialModel: null} as const,
  ])('accepts $type from every existing mode', (action) => {
    const existing: ManagementModal = {kind: 'show-usage', providerId: 'local', initialModel: null};

    const state = managementModalReducer(existing, action);

    expect(state.kind).not.toBeUndefined();
  });
});

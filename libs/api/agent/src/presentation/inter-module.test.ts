import {
  type ManagedModelLock,
  type ManagedModelProvider,
  MODEL_UNAVAILABLE_ERROR_CODE,
  RUNNER_CAPABILITY_REQUIRED_ERROR_CODE,
} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {setDefaultHarness} from '#db/index.js';
import {agentTestSecretsClient} from '#test/fixtures/secrets-client.js';
import {createAgentInterModulePresentation} from './inter-module.js';

const workspaceDefaultsResolverMocks = vi.hoisted(() => ({
  getWorkspaceAgentValidationCatalog: vi.fn(),
}));

vi.mock('#core/workspace-agent-defaults-resolver.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#core/workspace-agent-defaults-resolver.js')>();
  workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog.mockImplementation(
    actual.getWorkspaceAgentValidationCatalog,
  );
  return {
    ...actual,
    getWorkspaceAgentValidationCatalog:
      workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog,
  };
});

describe('agent inter-module presentation', () => {
  beforeEach(() => {
    workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog.mockClear();
  });

  test('preserves the original validation catalog response', async () => {
    const presentation = createAgentInterModulePresentation({secrets: agentTestSecretsClient});

    const catalog = await presentation.handlers.getValidationCatalog(
      {},
      {signal: new AbortController().signal},
    );

    expect(catalog.version).toBe(1);
    expect(catalog).not.toHaveProperty('default_harness_id');
  });

  test('uses the built-in default harness without workspace context', async () => {
    const presentation = createAgentInterModulePresentation({secrets: agentTestSecretsClient});

    const catalog = await presentation.handlers.getValidationCatalogV2(
      {workspaceId: null},
      {signal: new AbortController().signal},
    );

    expect(catalog.default_harness_id).toBe('pi');
    expect(
      workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog,
    ).not.toHaveBeenCalled();
  });

  test('uses the built-in default harness for a workspace without settings', async () => {
    const workspaceId = crypto.randomUUID();
    const presentation = createAgentInterModulePresentation({secrets: agentTestSecretsClient});

    const catalog = await presentation.handlers.getValidationCatalogV2(
      {workspaceId},
      {signal: new AbortController().signal},
    );

    expect(catalog.default_harness_id).toBe('pi');
    expect(workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog).toHaveBeenCalledWith(
      workspaceId,
      undefined,
      undefined,
    );
  });

  test('loads the workspace default harness for managed inference validation', async () => {
    const workspaceId = crypto.randomUUID();
    await setDefaultHarness({workspaceId, harnessId: 'claude'});
    const presentation = createAgentInterModulePresentation({
      secrets: agentTestSecretsClient,
      managedProvider: {
        id: 'shipfox',
        label: 'Shipfox',
        models: [{id: 'managed-model', label: 'Managed model', api: 'anthropic-messages'}],
        defaultModel: 'managed-model',
        resolveCredentials: vi.fn(),
      },
      workspaceProviders: 'disabled',
    });

    const catalog = await presentation.handlers.getValidationCatalogV2(
      {workspaceId},
      {signal: new AbortController().signal},
    );

    expect(catalog.default_harness_id).toBe('claude');
  });

  describe('locked managed models', () => {
    const lock: ManagedModelLock = {
      label: 'Add credits to use',
      notice: {reason: 'model-locked', message: 'Managed model needs credits.'},
    };

    function presentationWith(availability: ManagedModelProvider['availability']) {
      return createAgentInterModulePresentation({
        secrets: agentTestSecretsClient,
        managedProvider: {
          id: 'shipfox',
          label: 'Shipfox',
          models: [
            {id: 'managed-model', label: 'Managed model', api: 'anthropic-messages'},
            {id: 'other-model', label: 'Other model', api: 'anthropic-messages'},
          ],
          defaultModel: 'managed-model',
          availability,
          resolveCredentials: vi.fn(),
        },
      });
    }

    test('returns the locked model ids for a workspace and keeps them in the model list', async () => {
      const workspaceId = crypto.randomUUID();
      const availability = vi.fn().mockResolvedValue(new Map([['managed-model', lock]]));
      const presentation = presentationWith(availability);

      const catalog = await presentation.handlers.getValidationCatalogV2(
        {workspaceId},
        {signal: new AbortController().signal},
      );

      expect(catalog.locked_model_ids_by_provider).toEqual({shipfox: ['managed-model']});
      expect(
        catalog.harnesses.find((harness) => harness.id === 'pi')?.model_ids_by_provider?.shipfox,
      ).toContain('managed-model');
      expect(availability).toHaveBeenCalledWith({workspaceId});
    });

    test('omits locked ids without workspace context', async () => {
      const availability = vi.fn().mockResolvedValue(new Map([['managed-model', lock]]));
      const presentation = presentationWith(availability);

      const catalog = await presentation.handlers.getValidationCatalogV2(
        {workspaceId: null},
        {signal: new AbortController().signal},
      );

      expect(catalog.locked_model_ids_by_provider).toBeUndefined();
      expect(availability).not.toHaveBeenCalled();
    });

    test('omits locked ids when nothing is locked', async () => {
      const presentation = presentationWith(vi.fn().mockResolvedValue(new Map()));

      const catalog = await presentation.handlers.getValidationCatalogV2(
        {workspaceId: crypto.randomUUID()},
        {signal: new AbortController().signal},
      );

      expect(catalog.locked_model_ids_by_provider).toBeUndefined();
    });

    test('still returns the catalog when availability fails', async () => {
      const presentation = presentationWith(vi.fn().mockRejectedValue(new Error('unavailable')));

      const catalog = await presentation.handlers.getValidationCatalogV2(
        {workspaceId: crypto.randomUUID()},
        {signal: new AbortController().signal},
      );

      expect(catalog.locked_model_ids_by_provider).toBeUndefined();
      expect(catalog.version).toBe(2);
    });
  });

  test('returns an empty model result for a workspace without configured providers', async () => {
    const workspaceId = crypto.randomUUID();
    const presentation = createAgentInterModulePresentation({secrets: agentTestSecretsClient});

    const result = await presentation.handlers.getWorkspaceModels(
      {workspaceId},
      {signal: new AbortController().signal},
    );

    expect(result).toEqual({
      models: [],
      default_model: null,
      attribution: null,
      managed_provider_id: null,
    });
  });

  test('preserves managed provider policy details for runtime credentials', async () => {
    const managedProvider: ManagedModelProvider = {
      id: 'shipfox',
      label: 'Shipfox',
      models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
      defaultModel: 'managed-model',
      resolveCredentials: vi.fn(),
    };
    const presentation = createAgentInterModulePresentation({
      secrets: agentTestSecretsClient,
      managedProvider,
      workspaceProviders: 'disabled',
    });
    const input = {
      workspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi' as const,
      provider: 'anthropic' as const,
      model: 'claude-opus-4-8',
      thinking: 'high' as const,
      renewableInference: false,
    };

    const result = await Promise.resolve(
      presentation.handlers.resolveRuntimeCredentials(input, {
        signal: new AbortController().signal,
      }),
    ).catch((error: unknown) => error);

    expect(
      isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result),
    ).toBe(true);
    if (
      !isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result)
    ) {
      throw new Error('Expected a managed provider policy error');
    }
    expect(result.code).toBe('workspace-providers-disabled');
    expect(result.details).toEqual({
      message: 'This instance only supports provider `shipfox`.',
      managed_provider_id: 'shipfox',
    });
  });

  describe('resolveAgentConfig failures', () => {
    const managedProvider: ManagedModelProvider = {
      id: 'shipfox',
      label: 'Shipfox',
      models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
      defaultModel: 'managed-model',
      resolveCredentials: vi.fn(),
    };

    async function resolveFailure(
      config: Record<string, string>,
      params: {workspaceProviders?: 'enabled' | 'disabled'} = {},
    ) {
      const presentation = createAgentInterModulePresentation({
        secrets: agentTestSecretsClient,
        managedProvider,
        workspaceProviders: params.workspaceProviders ?? 'enabled',
      });
      const result = await Promise.resolve(
        presentation.handlers.resolveAgentConfig(
          {workspaceId: null, config},
          {signal: new AbortController().signal},
        ),
      ).catch((error: unknown) => error);
      if (!isInterModuleKnownError(agentInterModuleContract.methods.resolveAgentConfig, result)) {
        throw new Error('Expected an agent config known error');
      }
      return result;
    }

    test('names an unknown model with its provider', async () => {
      const result = await resolveFailure({provider: 'anthropic', model: 'no-such-model'});

      expect(result.code).toBe('agent-config-invalid');
      expect(result.details).toEqual({
        reason: 'model-unknown',
        model: 'no-such-model',
        provider: 'anthropic',
      });
    });

    test('names an unsupported provider', async () => {
      const result = await resolveFailure({provider: 'no-such-provider'});

      expect(result.details).toEqual({
        reason: 'provider-unsupported',
        provider: 'no-such-provider',
      });
    });

    test('names a provider the harness does not support', async () => {
      const result = await resolveFailure({harness: 'claude', provider: 'openai'});

      expect(result.details).toEqual({reason: 'harness-unsupported', provider: 'openai'});
    });

    test('names a thinking level the harness does not support', async () => {
      const result = await resolveFailure({
        harness: 'claude',
        provider: 'anthropic',
        thinking: 'xhigh',
      });

      expect(result.details).toEqual({reason: 'thinking-unsupported'});
    });

    test('names the managed provider when workspace providers are disabled', async () => {
      const result = await resolveFailure(
        {provider: 'anthropic'},
        {workspaceProviders: 'disabled'},
      );

      expect(result.details).toEqual({
        reason: 'workspace-providers-disabled',
        message: 'This instance only supports provider `shipfox`.',
        provider: 'shipfox',
        managed_provider_id: 'shipfox',
      });
    });
  });

  test('maps a managed provider capability failure to the runtime contract', async () => {
    const managedProvider: ManagedModelProvider = {
      id: 'shipfox',
      label: 'Shipfox',
      models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
      defaultModel: 'managed-model',
      resolveCredentials: vi.fn(() => {
        throw Object.assign(new Error('runner capability required'), {
          code: RUNNER_CAPABILITY_REQUIRED_ERROR_CODE,
        });
      }),
    };
    const presentation = createAgentInterModulePresentation({
      secrets: agentTestSecretsClient,
      managedProvider,
      workspaceProviders: 'disabled',
    });

    const result = await Promise.resolve(
      presentation.handlers.resolveRuntimeCredentials(
        {
          workspaceId: crypto.randomUUID(),
          runId: crypto.randomUUID(),
          stepAttemptId: crypto.randomUUID(),
          harness: 'pi',
          provider: 'shipfox',
          model: 'managed-model',
          thinking: 'high',
          renewableInference: false,
        },
        {signal: new AbortController().signal},
      ),
    ).catch((error: unknown) => error);

    expect(
      isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result),
    ).toBe(true);
    if (
      !isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result)
    ) {
      throw new Error('Expected a runner capability known error');
    }
    expect(result.code).toBe(RUNNER_CAPABILITY_REQUIRED_ERROR_CODE);
    expect(result.details).toEqual({});
  });

  describe('managed model availability', () => {
    const notice = {
      reason: 'model-locked',
      message: 'Managed model needs credits.',
      requiredAction: {reason: 'add-credits', message: 'Add credits', url: '/billing'},
    };

    function presentationWith(availability: ManagedModelProvider['availability']) {
      return createAgentInterModulePresentation({
        secrets: agentTestSecretsClient,
        workspaceProviders: 'disabled',
        managedProvider: {
          id: 'shipfox',
          label: 'Shipfox',
          models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
          defaultModel: 'managed-model',
          availability,
          resolveCredentials: vi.fn(() =>
            Promise.resolve({
              api: 'openai-responses' as const,
              baseUrl: 'https://gateway.example.test/',
              credentials: {api_key: 'managed-token'},
            }),
          ),
        },
      });
    }

    function resolve(
      presentation: ReturnType<typeof presentationWith>,
      overrides: {renewal?: boolean} = {},
    ) {
      return Promise.resolve(
        presentation.handlers.resolveRuntimeCredentials(
          {
            workspaceId: crypto.randomUUID(),
            runId: crypto.randomUUID(),
            stepAttemptId: crypto.randomUUID(),
            harness: 'pi',
            provider: 'shipfox',
            model: 'managed-model',
            thinking: 'high',
            renewableInference: true,
            ...overrides,
          },
          {signal: new AbortController().signal},
        ),
      ).catch((error: unknown) => error);
    }

    test('maps a locked model to the agent-model-unavailable known error with its notice', async () => {
      const presentation = presentationWith(() =>
        Promise.resolve(new Map([['managed-model', {label: 'Locked', notice}]])),
      );

      const result = await resolve(presentation);

      if (
        !isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result)
      ) {
        throw new Error('Expected a known error');
      }
      expect(result.code).toBe(MODEL_UNAVAILABLE_ERROR_CODE);
      expect(result.details).toEqual({model: 'managed-model', notice});
    });

    test('maps an availability failure to model-availability-unavailable', async () => {
      const presentation = presentationWith(() => Promise.reject(new Error('down')));

      const result = await resolve(presentation);

      if (
        !isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result)
      ) {
        throw new Error('Expected a known error');
      }
      expect(result.code).toBe('model-availability-unavailable');
    });

    test('does not check availability on renewal', async () => {
      const availability = vi.fn(() =>
        Promise.resolve(new Map([['managed-model', {label: 'Locked', notice}]])),
      );

      const result = await resolve(presentationWith(availability), {renewal: true});

      expect(result).toMatchObject({provider_id: 'shipfox'});
      expect(availability).not.toHaveBeenCalled();
    });
  });
});

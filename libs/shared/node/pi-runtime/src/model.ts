import type {CredentialStore} from '@earendil-works/pi-ai';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {type CustomModelProviderRuntimeConfigDto, piModelProviderId} from '@shipfox/api-agent-dto';
import {
  type AssertEgressAllowed,
  type ModelRuntimeInstance,
  registerCustomProvider,
} from '#custom-provider.js';
import {AgentConfigError} from '#errors.js';

export type ResolvedModel = NonNullable<ReturnType<ModelRuntimeInstance['getModel']>>;

export interface PiModel {
  readonly modelRuntime: ModelRuntimeInstance;
  readonly model: ResolvedModel;
}

/**
 * Builds the pi model runtime for one agent configuration, the same way for a runner step and
 * a server turn. The caller owns the credential store, so a runner can renew a token while the
 * API passes a fixed in-memory store.
 */
export async function createPiModel({
  provider,
  model,
  thinking,
  credentials,
  credentialStore,
  customProvider,
  assertEgressAllowed,
  modelsPath,
}: {
  provider: string;
  model: string;
  thinking: string;
  credentials: Record<string, string>;
  credentialStore: CredentialStore;
  customProvider: CustomModelProviderRuntimeConfigDto | undefined;
  assertEgressAllowed: AssertEgressAllowed;
  /** `null` skips `models.json`, so pi reads and writes nothing under the home directory. */
  modelsPath?: string | null | undefined;
}): Promise<PiModel> {
  const modelRuntime = await ModelRuntime.create({
    credentials: credentialStore,
    ...(modelsPath === undefined ? {} : {modelsPath}),
  });
  if (customProvider !== undefined) {
    await registerCustomProvider({
      modelRuntime,
      provider,
      credentials,
      customProvider,
      assertEgressAllowed,
    });
  }
  const resolved = resolveModel(modelRuntime, provider, model);
  if (thinking === 'default') omitReasoningOption(modelRuntime);
  if (!modelRuntime.hasConfiguredAuth(resolved.provider)) {
    throw new AgentConfigError(
      `No credentials configured for provider "${provider}". ` +
        'Verify the provider is configured for this workspace.',
      'provider_not_configured',
    );
  }
  return {modelRuntime, model: resolved};
}

function omitReasoningOption(modelRuntime: ModelRuntimeInstance): void {
  const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
  modelRuntime.streamSimple = (requestModel, context, options) => {
    // Pi derives `reasoning` from the session level, so remove it for provider defaults.
    const providerOptions = options === undefined ? undefined : {...options};
    if (providerOptions !== undefined) delete providerOptions.reasoning;
    return streamSimple(requestModel, context, providerOptions);
  };
}

// pi's `find` returns undefined for both an unknown provider and a known provider that
// lacks the model, so split them on the registry's provider set to give an actionable
// message (and, when another provider carries the same id, a did-you-mean hint).
export function resolveModel(
  modelRuntime: ModelRuntimeInstance,
  provider: string,
  modelId: string,
): ResolvedModel {
  const piProvider = piModelProviderId(provider);
  const model = modelRuntime.getModel(piProvider, modelId);
  if (model) return model;

  const all = modelRuntime.getModels();
  const knownProviders = new Set(all.map((entry) => entry.provider));
  if (!knownProviders.has(piProvider)) {
    throw new AgentConfigError(
      `Unknown provider "${provider}" for agent step. ` +
        'Known providers are pi built-ins plus any from models.json.',
      'provider_unsupported',
    );
  }

  const alternativeProvider = all.find((entry) => entry.id === modelId)?.provider;
  const hint =
    alternativeProvider === undefined
      ? ''
      : ` Did you mean to set provider: ${alternativeProvider}?`;
  throw new AgentConfigError(
    `Model "${modelId}" is not available for provider "${provider}".${hint}`,
    'model_unavailable',
  );
}

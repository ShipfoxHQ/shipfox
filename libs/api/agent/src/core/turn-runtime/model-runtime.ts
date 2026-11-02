import type {
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import {
  type ManagedModelProvider,
  ManagedModelUnavailableError,
  piModelProviderId,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {EgressDeniedError} from '@shipfox/node-egress-guard';
import type {AgentTurn, Conversation} from '../entities/conversation.js';
import {
  isAgentConfigResolutionError,
  ManagedModelAvailabilityError,
  ModelProviderConfigNotFoundError,
  WorkspaceProvidersDisabledError,
} from '../errors.js';
import {egressPolicy} from '../model-provider-validation.js';
import {builtInAgentConfigInput} from '../resolve-agent-config.js';
import {resolveRuntimeCredentials} from '../resolve-runtime-credentials.js';
import type {AgentSecretsClient} from '../secrets-client.js';
import {createWorkspaceAgentDefaultsResolver} from '../workspace-agent-defaults-resolver.js';
import {TurnFailure} from './failures.js';
import {createPinnedFetch} from './pinned-fetch.js';

/** A pi model, ready to stream one request. */
export interface ModelCallRuntime {
  model: Model<string>;
  thinking: string;
  stream(context: Context, options: SimpleStreamOptions): AssistantMessageEventStream;
}

export interface ModelRuntimeParams {
  conversation: Conversation;
  turn: AgentTurn;
  /** True once the turn has made a model call, so a model locked since then doesn't end it. */
  renewal: boolean;
}

export type CreateModelRuntime = (params: ModelRuntimeParams) => Promise<ModelCallRuntime>;

export interface ServerModelRuntimeDeps {
  secrets: AgentSecretsClient;
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
}

/** Turns the failures of credential and model resolution into what a turn records. */
export function translateModelSetupError(error: unknown): never {
  if (error instanceof ManagedModelUnavailableError) {
    throw new TurnFailure('model_unavailable', error.message, false, {cause: error});
  }
  if (error instanceof ManagedModelAvailabilityError) {
    throw new TurnFailure('provider_unavailable', error.message, true, {cause: error});
  }
  if (
    error instanceof ModelProviderConfigNotFoundError ||
    error instanceof WorkspaceProvidersDisabledError
  ) {
    throw new TurnFailure('credentials_unavailable', error.message, false, {cause: error});
  }
  if (isAgentConfigResolutionError(error)) {
    throw new TurnFailure('model_unavailable', error.message, false, {cause: error});
  }
  if (error instanceof Error && error.name === 'AgentConfigError') {
    const issue = (error as Error & {agentConfigIssue?: string}).agentConfigIssue;
    throw new TurnFailure(
      issue === 'model_unavailable' ? 'model_unavailable' : 'credentials_unavailable',
      error.message,
      false,
      {cause: error},
    );
  }
  throw error;
}

async function assertCustomProviderEgress(url: string, label: string): Promise<void> {
  const {assertEgressAllowed} = await import('@shipfox/node-egress-guard');
  try {
    await assertEgressAllowed(url, egressPolicy());
  } catch (error) {
    if (!(error instanceof EgressDeniedError)) throw error;
    throw new TurnFailure(
      'credentials_unavailable',
      `${label} is not allowed (${error.reason})`,
      false,
      {
        cause: error,
      },
    );
  }
}

/**
 * The model of a server turn, built the way a runner builds it. pi loads here, inside the
 * activity, so it never reaches the workflow bundle or API startup. A workspace's custom provider
 * is called through a pinned `fetch`. The managed provider is an operator-configured gateway and
 * uses the default one.
 */
export function createServerModelRuntime(deps: ServerModelRuntimeDeps): CreateModelRuntime {
  return async ({conversation, turn, renewal}) => {
    if (turn.provider === null || turn.model === null) {
      throw new TurnFailure('model_unavailable', 'No model resolves for this workspace', false);
    }
    try {
      const resolveConfig = await createWorkspaceAgentDefaultsResolver(
        conversation.workspaceId,
        deps.managedProvider,
        deps.workspaceProviders,
      );
      const config = resolveConfig({
        ...builtInAgentConfigInput,
        provider: turn.provider,
        model: turn.model,
      });
      const resolved = await resolveRuntimeCredentials(
        {
          workspaceId: conversation.workspaceId,
          subject: {
            kind: 'conversation',
            projectId: conversation.projectId,
            conversationId: conversation.id,
            agentKey: conversation.agentKey,
          },
          renewal,
          harness: 'pi',
          provider: config.provider,
          model: config.model,
          thinking: config.thinking,
        },
        {
          secrets: deps.secrets,
          managedProvider: deps.managedProvider,
          workspaceProviders: deps.workspaceProviders,
        },
      );

      const pi = await import('@shipfox/node-pi-runtime');
      const customProvider = resolved.custom_provider;
      const managed = deps.managedProvider?.id === config.provider;
      const {modelRuntime, model} = await pi.createPiModel({
        provider: config.provider,
        model: config.model,
        thinking: config.thinking,
        credentials: resolved.credentials,
        credentialStore: pi.createInMemoryCredentialStore(
          customProvider === undefined
            ? {
                [piModelProviderId(config.provider)]: pi.toPiRuntimeCredential(
                  config.provider,
                  resolved.credentials,
                ),
              }
            : {},
        ),
        customProvider,
        assertEgressAllowed: managed ? () => Promise.resolve() : assertCustomProviderEgress,
        modelsPath: null,
      });
      const pinnedFetch =
        customProvider !== undefined && !managed
          ? createPinnedFetch({policy: egressPolicy()})
          : undefined;

      return {
        model: model as Model<string>,
        thinking: config.thinking,
        stream: (context, options) =>
          modelRuntime.streamSimple(model, context, {
            ...options,
            ...(pinnedFetch === undefined ? {} : {fetch: pinnedFetch}),
          }),
      };
    } catch (error) {
      return translateModelSetupError(error);
    }
  };
}

import type {ManagedModelProvider, WorkspaceProvidersPolicy} from '@shipfox/api-agent-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {Context} from '@temporalio/activity';
import {ApplicationFailure} from '@temporalio/common';
import {AgentSessionUnavailableError, ConversationEntryUnreadableError} from '#core/errors.js';
import {recoverConversations} from '#core/recover-conversations.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {AgentAdmissionPolicy, TurnAdmissionWorkspaces} from '#core/turn-admission.js';
import {
  beginConversationTurn,
  type CompactionCause,
  type CreateModelRuntime,
  claimConversationInputs,
  compactConversation,
  createServerModelRuntime,
  deliverConversationReply,
  finishConversationTurn,
  type ModelCallResult,
  runModelCall,
  runToolCall,
  TurnFailure,
  type TurnFailureCode,
} from '#core/turn-runtime/index.js';
import {TOOL_CALL_MAX_ATTEMPTS} from '../constants.js';
import {wakeConversation} from '../wake-conversation.js';

export interface ConversationActivityDeps {
  secrets: AgentSecretsClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  workspaces: TurnAdmissionWorkspaces;
  admission?: {policy: AgentAdmissionPolicy} | undefined;
  /** Replaces the wake the recovery sweep sends. Tests use it to see who is woken. */
  wake?: ((conversationId: string) => Promise<void>) | undefined;
  /** Replaces the model setup. Tests use it to stream from a scripted model. */
  createModelRuntime?: CreateModelRuntime | undefined;
}

export type ModelCallActivityResult = ModelCallResult;

/**
 * A failure the workflow reads by its `type`, which is a turn failure code. A retryable one
 * lets Temporal try again, and the rest end the call at once.
 */
function toActivityFailure(error: unknown): never {
  if (error instanceof TurnFailure) {
    throw ApplicationFailure.create({
      message: error.message,
      type: error.code,
      nonRetryable: !error.retryable,
      cause: error,
    });
  }
  if (
    error instanceof ConversationEntryUnreadableError ||
    error instanceof AgentSessionUnavailableError
  ) {
    // A row that can't be opened stays that way. A gap would silently cut pi's entry chain.
    throw ApplicationFailure.nonRetryable(
      error.message,
      'session_unreadable' satisfies TurnFailureCode,
    );
  }
  throw error;
}

/**
 * The turn loop's activities. Each writes to Postgres and returns small values, so no message
 * or tool result enters Temporal history. Each is safe to repeat after a crash that follows its
 * commit.
 */
export function createConversationActivities(deps: ConversationActivityDeps) {
  const createModelRuntime =
    deps.createModelRuntime ??
    createServerModelRuntime({
      secrets: deps.secrets,
      managedProvider: deps.managedProvider,
      workspaceProviders: deps.workspaceProviders,
    });

  return {
    beginTurn: async (input: {conversationId: string}): Promise<{turnId: string} | undefined> =>
      await beginConversationTurn({conversationId: input.conversationId, deps}),

    claimPendingInputs: async (input: {
      conversationId: string;
      turnId: string;
    }): Promise<{claimed: number; stopRequested: boolean}> => await claimConversationInputs(input),

    modelCall: async (input: {
      conversationId: string;
      turnId: string;
      modelCallIndex: number;
    }): Promise<ModelCallActivityResult> => {
      const context = Context.current();
      try {
        return await runModelCall({
          ...input,
          createModelRuntime,
          signal: context.cancellationSignal,
          heartbeat: () => context.heartbeat(),
        });
      } catch (error) {
        return toActivityFailure(error);
      }
    },

    compactConversation: async (input: {
      conversationId: string;
      turnId: string;
      modelCallIndex: number;
      cause: CompactionCause;
    }): Promise<{compacted: boolean}> => {
      const context = Context.current();
      try {
        return await compactConversation({
          ...input,
          createModelRuntime,
          signal: context.cancellationSignal,
          heartbeat: () => context.heartbeat(),
        });
      } catch (error) {
        return toActivityFailure(error);
      }
    },

    toolCall: async (input: {
      conversationId: string;
      turnId: string;
      modelCallIndex: number;
      callIndex: number;
    }): Promise<{status: 'success' | 'error'}> => {
      try {
        return await runToolCall({
          ...input,
          integrations: deps.integrations,
          lastAttempt: Context.current().info.attempt >= TOOL_CALL_MAX_ATTEMPTS,
        });
      } catch (error) {
        return toActivityFailure(error);
      }
    },

    finishTurn: async (input: {
      conversationId: string;
      turnId: string;
      status: 'succeeded' | 'failed' | 'stopped';
      failureCode?: TurnFailureCode | undefined;
    }): Promise<void> => {
      await finishConversationTurn(input);
    },

    deliverReply: async (input: {
      conversationId: string;
      turnId?: string | undefined;
    }): Promise<void> =>
      await deliverConversationReply({...input, integrations: deps.integrations}),

    recoverConversations: async (): Promise<{woken: number}> =>
      await recoverConversations({wake: deps.wake ?? wakeConversation}),
  };
}

export type ConversationActivities = ReturnType<typeof createConversationActivities>;

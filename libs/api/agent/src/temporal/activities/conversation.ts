import type {ManagedModelProvider, WorkspaceProvidersPolicy} from '@shipfox/api-agent-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {Context} from '@temporalio/activity';
import {ApplicationFailure} from '@temporalio/common';
import {AgentSessionUnavailableError, ConversationEntryUnreadableError} from '#core/errors.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {
  beginConversationTurn,
  type CreateModelRuntime,
  claimConversationInputs,
  createServerModelRuntime,
  finishConversationTurn,
  runModelCall,
  runToolCall,
  TurnFailure,
  type TurnFailureCode,
} from '#core/turn-runtime/index.js';
import {TOOL_CALL_MAX_ATTEMPTS} from '../constants.js';

export interface ConversationActivityDeps {
  secrets: AgentSecretsClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  /** Replaces the model setup. Tests use it to stream from a scripted model. */
  createModelRuntime?: CreateModelRuntime | undefined;
}

export interface ModelCallActivityResult {
  stopReason: 'stop' | 'length' | 'toolUse';
  toolCallCount: number;
}

/**
 * A failure the workflow reads by its `type`, which is a turn failure code. A retryable one
 * lets Temporal try again, and the rest end the call at once.
 */
function toActivityFailure(error: unknown): never {
  if (error instanceof TurnFailure) {
    throw error.retryable
      ? ApplicationFailure.retryable(error.message, error.code, undefined, {cause: error})
      : ApplicationFailure.nonRetryable(error.message, error.code, undefined, {cause: error});
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

    claimPendingInputs: async (input: {conversationId: string}): Promise<number> =>
      await claimConversationInputs(input.conversationId),

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
      status: 'succeeded' | 'failed';
      failureCode?: TurnFailureCode | undefined;
    }): Promise<void> => {
      await finishConversationTurn(input);
    },
  };
}

export type ConversationActivities = ReturnType<typeof createConversationActivities>;

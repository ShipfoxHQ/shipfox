import type {ManagedModelProvider, WorkspaceProvidersPolicy} from '@shipfox/api-agent-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {newConversationRecordId} from '#db/conversations.js';
import {
  claimPendingInputs,
  finishTurnRow,
  getConversationById,
  openTurn,
  pinSystemEntry,
} from '#db/turn-runtime.js';
import {conversationTurnCount} from '#metrics/index.js';
import {CONVERSATION_SESSION_VERSION} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  sealConversationEntry,
} from '../conversation-sealing.js';
import type {Conversation} from '../entities/conversation.js';
import {builtInAgentConfigInput} from '../resolve-agent-config.js';
import {createWorkspaceAgentDefaultsResolver} from '../workspace-agent-defaults-resolver.js';
import {listConversationToolSet} from './conversation-tools.js';
import {systemMessageEntry} from './entries.js';
import type {TurnFailureCode} from './failures.js';
import {buildPinnedPrompt} from './pinned-prompt.js';

export interface TurnLifecycleDeps {
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
}

/**
 * Writes the pinned system entry: the base prompt, a project header, and the tool definitions.
 * Everything a prompt holds beyond the entries comes from here, once, so a release or a change
 * to the tool catalog never alters a running conversation. It has to take `seq` 1 before anything
 * else claims it, because pi reads only a leading system message as the base prompt.
 */
async function pinConversationPrompt(
  conversation: Conversation,
  deps: TurnLifecycleDeps,
): Promise<void> {
  if (conversation.lastSeq > 0) return;

  const [{project}, toolSet] = await Promise.all([
    deps.projects.getProjectById({projectId: conversation.projectId}),
    listConversationToolSet(deps.integrations),
  ]);
  const itemId = await newConversationRecordId();
  await pinSystemEntry({
    conversationId: conversation.id,
    entry: {
      id: itemId,
      entryType: 'message',
      sessionVersion: CONVERSATION_SESSION_VERSION,
      sealedEntry: sealConversationEntry({
        key: await conversationDataKey(conversation.workspaceId),
        aad: aadForConversationItem({
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          itemId,
        }),
        entry: systemMessageEntry({
          prompt: buildPinnedPrompt({
            agentKey: conversation.agentKey,
            projectId: conversation.projectId,
            projectName: project?.name ?? 'unknown',
          }),
          tools: toolSet.definitions,
        }),
      }),
      meta: {role: 'system'},
    },
  });
}

/**
 * Starts a turn for the queued inputs, or returns the one already running. The prompt is pinned
 * first. A repeat after a crash finds the entry and the turn it wrote.
 */
export async function beginConversationTurn(params: {
  conversationId: string;
  deps: TurnLifecycleDeps;
}): Promise<{turnId: string} | undefined> {
  const conversation = await getConversationById(params.conversationId);
  if (!conversation) return undefined;

  await pinConversationPrompt(conversation, params.deps);

  const resolveConfig = await createWorkspaceAgentDefaultsResolver(
    conversation.workspaceId,
    params.deps.managedProvider,
    params.deps.workspaceProviders,
  );
  const {provider, model} = resolveConfig(builtInAgentConfigInput);
  const opened = await openTurn({conversationId: conversation.id, model, provider});
  return opened ? {turnId: opened.turn.id} : undefined;
}

/** Gives every queued input its `seq`, so a model call sees them and none lands inside a tool call. */
export async function claimConversationInputs(conversationId: string): Promise<number> {
  return await claimPendingInputs(conversationId);
}

export async function finishConversationTurn(params: {
  conversationId: string;
  turnId: string;
  status: 'succeeded' | 'failed';
  failureCode?: TurnFailureCode | undefined;
}): Promise<void> {
  const finished = await finishTurnRow({
    turnId: params.turnId,
    status: params.status,
    failureCode: params.failureCode,
  });
  // A repeat after the first commit finds the turn finished and counts nothing.
  if (!finished) return;
  const conversation = await getConversationById(params.conversationId);
  conversationTurnCount.add(1, {
    origin: conversation?.originKind ?? 'web',
    trigger: 'message',
    outcome: params.status,
  });
}

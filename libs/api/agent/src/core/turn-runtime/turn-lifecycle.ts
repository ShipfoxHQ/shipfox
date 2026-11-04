import type {
  ConversationTurnNoticeDto,
  ManagedModelProvider,
  WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {getRunningTurn, newConversationRecordId} from '#db/conversations.js';
import {
  claimPendingInputs,
  finishTurnRow,
  getConversationById,
  hasPendingTurnWork,
  type NewTimelineEntry,
  openTurn,
  pinSystemEntry,
  settleWorkWithoutTurn,
} from '#db/turn-runtime.js';
import {conversationTurnCount} from '#metrics/index.js';
import {CONVERSATION_SESSION_VERSION} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  sealConversationEntry,
} from '../conversation-sealing.js';
import {type Conversation, TURN_NOTICE_CUSTOM_TYPE} from '../entities/conversation.js';
import {isAgentConfigResolutionError, ProjectAgentNotFoundError} from '../errors.js';
import {type ResolvedProjectAgent, resolveProjectAgent} from '../project-agents.js';
import {builtInAgentConfigInput} from '../resolve-agent-config.js';
import {
  type AgentAdmissionPolicy,
  refuseTurn,
  type TurnAdmissionWorkspaces,
  type TurnRefusal,
} from '../turn-admission.js';
import {createWorkspaceAgentDefaultsResolver} from '../workspace-agent-defaults-resolver.js';
import {listConversationToolSet} from './conversation-tools.js';
import {systemMessageEntry, turnNoticeEntry} from './entries.js';
import type {TurnFailureCode} from './failures.js';
import {buildPinnedPrompt} from './pinned-prompt.js';

export interface TurnLifecycleDeps {
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  /** Reads the project's agent files. Without it, every conversation is with the built-in agent. */
  definitions?: DefinitionsInterModuleClient | undefined;
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  /** Reads the owner's membership and the workspace's operating state. */
  workspaces: TurnAdmissionWorkspaces;
  admission?: {policy: AgentAdmissionPolicy} | undefined;
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

  const [{project}, integration, agent] = await Promise.all([
    deps.projects.getProjectById({projectId: conversation.projectId}),
    integrationPromptContext(conversation, deps.integrations),
    resolveConversationAgent(conversation, deps),
  ]);
  const toolSet = await listConversationToolSet({
    integrations: deps.integrations,
    workspaceId: conversation.workspaceId,
    projectId: conversation.projectId,
    agent,
  });
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
            agent,
            projectId: conversation.projectId,
            projectName: project?.name ?? 'unknown',
            integration,
          }),
          tools: toolSet.definitions,
        }),
      }),
      meta: {role: 'system'},
    },
    agentContentHash: agent.kind === 'configured' ? agent.agent.contentHash : null,
  });
}

function resolveConversationAgent(
  conversation: Conversation,
  deps: TurnLifecycleDeps,
): Promise<ResolvedProjectAgent> {
  return resolveProjectAgent({
    definitions: deps.definitions,
    workspaceId: conversation.workspaceId,
    projectId: conversation.projectId,
    key: conversation.agentKey,
  });
}

/**
 * What an integration conversation adds to its prompt. A provider that no longer lists the
 * interaction capability adds nothing, so the conversation still runs.
 */
async function integrationPromptContext(
  conversation: Conversation,
  integrations: IntegrationsModuleClient,
): Promise<{provider: string; replyGuidance: string} | undefined> {
  if (conversation.originKind !== 'integration' || conversation.originProvider === null) {
    return undefined;
  }
  const {providers} = await integrations.listInteractionProviders({});
  const provider = providers.find(({provider: id}) => id === conversation.originProvider);
  return provider
    ? {provider: provider.provider, replyGuidance: provider.replyGuidance}
    : undefined;
}

interface TurnModelSelection {
  provider: string | null;
  model: string | null;
  thinking: string | null;
}

/**
 * The model a new turn uses: the agent file's `provider`, `model`, and `thinking` when it sets
 * them, and the workspace defaults for the rest. The file is read at every turn start, because
 * the model isn't part of the pinned prompt. A custom agent that is gone throws
 * `ProjectAgentNotFoundError`.
 * Defaults that no longer resolve open the turn with no model, and its first model call fails it
 * with a recorded cause. Throwing here would retry without end.
 */
async function resolveTurnModel(
  conversation: Conversation,
  deps: TurnLifecycleDeps,
): Promise<TurnModelSelection> {
  const agent = await resolveConversationAgent(conversation, deps);
  try {
    const resolveConfig = await createWorkspaceAgentDefaultsResolver(
      conversation.workspaceId,
      deps.managedProvider,
      deps.workspaceProviders,
    );
    const selection = agent.kind === 'configured' ? agent.agent.document : {};
    const {provider, model, thinking} = resolveConfig({
      ...builtInAgentConfigInput,
      ...(selection.provider === undefined ? {} : {provider: selection.provider}),
      ...(selection.model === undefined ? {} : {model: selection.model}),
      ...(selection.thinking === undefined ? {} : {thinking: selection.thinking}),
    });
    return {provider, model, thinking};
  } catch (error) {
    if (!isAgentConfigResolutionError(error)) throw error;
    logger().warn(
      {err: error, conversationId: conversation.id},
      'No model resolves for a conversation',
    );
    return {provider: null, model: null, thinking: null};
  }
}

export const AGENT_UNAVAILABLE_NOTICE: ConversationTurnNoticeDto = {
  code: 'agent_unavailable',
  message: 'This agent no longer exists in the project. Start a new conversation.',
  required_action: null,
};

export async function sealTurnNotice(
  conversation: Conversation,
  notice: ConversationTurnNoticeDto,
): Promise<NewTimelineEntry> {
  const itemId = await newConversationRecordId();
  return {
    id: itemId,
    entryType: 'custom',
    sessionVersion: CONVERSATION_SESSION_VERSION,
    sealedEntry: sealConversationEntry({
      key: await conversationDataKey(conversation.workspaceId),
      aad: aadForConversationItem({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        itemId,
      }),
      entry: turnNoticeEntry(notice),
    }),
    meta: {custom_type: TURN_NOTICE_CUSTOM_TYPE},
  };
}

/**
 * Settles what a refused conversation has pending. Its inputs are claimed, so they take a `seq`
 * after the pinned prompt, and the notice, when there is one, follows them.
 */
async function settleRefusedTurn(conversation: Conversation, refusal: TurnRefusal): Promise<void> {
  const settled = await settleWorkWithoutTurn({
    conversationId: conversation.id,
    notice: refusal.notice ? await sealTurnNotice(conversation, refusal.notice) : undefined,
  });
  if (!settled) return;
  conversationTurnCount.add(1, {
    origin: conversation.originKind,
    trigger: 'message',
    outcome: 'denied',
  });
}

/**
 * Starts a turn for the queued inputs or a requested retry, or returns the one already running.
 * The prompt is pinned first, so a refused first turn can't take its place at `seq` 1. A turn that
 * is already running is never stopped by admission, as with a running step. A repeat after a crash
 * finds the entry and the turn it wrote.
 */
export async function beginConversationTurn(params: {
  conversationId: string;
  deps: TurnLifecycleDeps;
}): Promise<{turnId: string} | undefined> {
  const conversation = await getConversationById(params.conversationId);
  if (!conversation) return undefined;

  try {
    await pinConversationPrompt(conversation, params.deps);
  } catch (error) {
    if (!(error instanceof ProjectAgentNotFoundError)) throw error;
    // The agent's file was deleted before its first turn. The conversation stays readable.
    await settleRefusedTurn(conversation, {notice: AGENT_UNAVAILABLE_NOTICE});
    return undefined;
  }

  // A running turn keeps the model it started with, whatever the workspace defaults are now.
  const running = await getRunningTurn(conversation.id);
  if (running) return {turnId: running.id};

  // Admission runs only for work that would open a turn, so an idle conversation costs no policy call.
  if (!(await hasPendingTurnWork(conversation.id))) return undefined;

  const refusal = await refuseTurn({
    conversation,
    workspaces: params.deps.workspaces,
    policy: params.deps.admission?.policy,
  });
  if (refusal) {
    await settleRefusedTurn(conversation, refusal);
    return undefined;
  }

  let selection: TurnModelSelection;
  try {
    selection = await resolveTurnModel(conversation, params.deps);
  } catch (error) {
    if (!(error instanceof ProjectAgentNotFoundError)) throw error;
    // The agent's file was deleted after the input was queued. A running turn was left alone above.
    await settleRefusedTurn(conversation, {notice: AGENT_UNAVAILABLE_NOTICE});
    return undefined;
  }
  const opened = await openTurn({conversationId: conversation.id, ...selection});
  return opened ? {turnId: opened.turn.id} : undefined;
}

/**
 * Gives every queued input its `seq`, so a model call sees them and none lands inside a tool call.
 * A requested stop claims nothing: the inputs wait for the turn after the stopped one.
 */
export async function claimConversationInputs(params: {
  conversationId: string;
  turnId: string;
}): Promise<{claimed: number; stopRequested: boolean}> {
  return await claimPendingInputs(params);
}

export const CONTEXT_OVERFLOW_NOTICE =
  'This conversation is too long to continue. Start a new conversation.';

/** The entry that tells a reader why a turn failed, for the failures that need one. */
async function failureNotice(
  conversation: Conversation,
  failureCode: TurnFailureCode | undefined,
): Promise<NewTimelineEntry | undefined> {
  if (failureCode !== 'context_overflow') return undefined;
  return await sealTurnNotice(conversation, {
    code: failureCode,
    message: CONTEXT_OVERFLOW_NOTICE,
    required_action: null,
  });
}

export async function finishConversationTurn(params: {
  conversationId: string;
  turnId: string;
  status: 'succeeded' | 'failed' | 'stopped';
  failureCode?: TurnFailureCode | undefined;
}): Promise<void> {
  const conversation = await getConversationById(params.conversationId);
  const finished = await finishTurnRow({
    ...params,
    notice: conversation ? await failureNotice(conversation, params.failureCode) : undefined,
  });
  // A repeat after the first commit finds the turn finished and counts nothing.
  if (!finished) return;
  conversationTurnCount.add(1, {
    origin: conversation?.originKind ?? 'web',
    trigger: 'message',
    outcome: params.status,
  });
}

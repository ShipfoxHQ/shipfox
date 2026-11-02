import type {
  ConversationTurnNoticeDto,
  ManagedModelProvider,
  WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
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
import {isAgentConfigResolutionError} from '../errors.js';
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
 * The model a new turn uses. Defaults that no longer resolve open the turn with no model, and its
 * first model call fails it with a recorded cause. Throwing here would retry without end.
 */
async function resolveTurnModel(
  conversation: Conversation,
  deps: TurnLifecycleDeps,
): Promise<{provider: string | null; model: string | null}> {
  try {
    const resolveConfig = await createWorkspaceAgentDefaultsResolver(
      conversation.workspaceId,
      deps.managedProvider,
      deps.workspaceProviders,
    );
    const {provider, model} = resolveConfig(builtInAgentConfigInput);
    return {provider, model};
  } catch (error) {
    if (!isAgentConfigResolutionError(error)) throw error;
    logger().warn(
      {err: error, conversationId: conversation.id},
      'No model resolves for a conversation',
    );
    return {provider: null, model: null};
  }
}

async function sealTurnNotice(
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

  await pinConversationPrompt(conversation, params.deps);

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

  const {provider, model} = await resolveTurnModel(conversation, params.deps);
  const opened = await openTurn({conversationId: conversation.id, model, provider});
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

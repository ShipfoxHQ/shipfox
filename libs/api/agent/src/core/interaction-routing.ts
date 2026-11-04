import {createHash} from 'node:crypto';
import type {
  InteractionRoutingCandidate,
  InteractionRoutingResult,
} from '@shipfox/api-agent-dto/inter-module';
import {evaluateConnectionAccess} from '@shipfox/api-projects-dto';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {
  findIntegrationConversation,
  insertIntegrationConversation,
  insertQueuedUserMessage,
  newConversationRecordId,
} from '#db/conversations.js';
import {requestTurnStop} from '#db/turn-runtime.js';
import {CONVERSATION_SESSION_VERSION, userMessageEntry} from './conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  sealConversationEntry,
} from './conversation-sealing.js';
import type {Conversation} from './entities/conversation.js';
import {SHIPPY_AGENT_KEY} from './shippy.js';
import {wrapUntrustedText} from './turn-runtime/tool-result.js';

/** The most a request stores. A model can't use more, and a thread can be read again with a tool. */
const INTERACTION_TEXT_MAX_BYTES = 64 * 1024;

export interface RouteInteractionParams {
  workspaceId: string;
  connectionId: string;
  provider: string;
  /** Names the delivery, so a replayed event posts its text once. */
  deliveryKey: string;
  interaction: {
    conversationKey: string;
    role: 'request' | 'follow_up' | 'stop';
    text: string;
    author?: {externalId: string; displayName?: string | undefined} | undefined;
  };
  /** The agents whose rules match a request. Ignored for an owned key. */
  candidates?: readonly InteractionRoutingCandidate[] | undefined;
}

export interface RouteInteractionDeps {
  projects: Pick<ProjectsModuleClient, 'getDefaultProject' | 'getProjectAccessPolicy'>;
  /** Tells the conversation to look at its inputs again. It never throws. */
  wake: (conversationId: string) => Promise<void>;
}

/**
 * Gives an interaction to the conversation that owns its key, or starts one for a request: with
 * the first candidate whose project takes the connection, or else with the default agent. A
 * follow-up or stop with no owner is dropped, because only a request starts a conversation. A stop
 * reaches its owner without posting text.
 */
export async function routeInteraction(
  params: RouteInteractionParams,
  deps: RouteInteractionDeps,
): Promise<InteractionRoutingResult> {
  const {interaction} = params;
  const messageId = deliveryMessageId(params.deliveryKey);

  const owner = await findIntegrationConversation({
    connectionId: params.connectionId,
    key: interaction.conversationKey,
  });
  if (owner) {
    const denial = await projectDenial({params, projectId: owner.projectId, deps});
    if (denial) return {outcome: 'dropped', reason: denial};
    return await deliverToOwner({params, owner, messageId, deps});
  }
  if (interaction.role !== 'request') return {outcome: 'dropped', reason: 'no-owner'};

  const eligible = await eligibleCandidates({params, deps});
  const [winner] = eligible;
  if (winner) {
    return await startConversation({
      params,
      messageId,
      deps,
      eligible,
      projectId: winner.projectId,
      agentKey: winner.agentKey,
    });
  }

  const {project} = await deps.projects.getDefaultProject({workspaceId: params.workspaceId});
  if (!project) return {outcome: 'dropped', reason: 'no-project'};
  // No other project answers when this one can't.
  const denial = await projectDenial({params, projectId: project.id, deps});
  if (denial) return {outcome: 'dropped', reason: denial};

  return await startConversation({
    params,
    messageId,
    deps,
    eligible,
    projectId: project.id,
    agentKey: SHIPPY_AGENT_KEY,
  });
}

/**
 * The candidates whose project takes the connection, in the order they claim a request: custom
 * agents before Shippys, then the earliest binding. One agent appears once, with its earliest rule.
 */
async function eligibleCandidates(args: {
  params: RouteInteractionParams;
  deps: Pick<RouteInteractionDeps, 'projects'>;
}): Promise<InteractionRoutingCandidate[]> {
  const ordered = [...(args.params.candidates ?? [])].sort(compareCandidates);
  const seen = new Set<string>();
  const denials = new Map<string, Awaited<ReturnType<typeof projectDenial>>>();
  const eligible: InteractionRoutingCandidate[] = [];
  for (const candidate of ordered) {
    const agent = JSON.stringify([candidate.projectId, candidate.agentKey]);
    if (seen.has(agent)) continue;
    seen.add(agent);
    if (!denials.has(candidate.projectId)) {
      denials.set(
        candidate.projectId,
        await projectDenial({params: args.params, projectId: candidate.projectId, deps: args.deps}),
      );
    }
    if (denials.get(candidate.projectId) === undefined) eligible.push(candidate);
  }
  return eligible;
}

function compareCandidates(a: InteractionRoutingCandidate, b: InteractionRoutingCandidate): number {
  const group = Number(a.agentKey === SHIPPY_AGENT_KEY) - Number(b.agentKey === SHIPPY_AGENT_KEY);
  if (group !== 0) return group;
  const bound = Date.parse(a.boundAt) - Date.parse(b.boundAt);
  if (bound !== 0) return bound;
  return a.subscriptionId.localeCompare(b.subscriptionId);
}

async function startConversation(args: {
  params: RouteInteractionParams;
  messageId: string;
  deps: RouteInteractionDeps;
  eligible: readonly InteractionRoutingCandidate[];
  projectId: string;
  agentKey: string;
}): Promise<InteractionRoutingResult> {
  const {params, messageId, deps} = args;
  const {interaction} = params;
  const key = await conversationDataKey(params.workspaceId);
  const conversationId = await newConversationRecordId();
  const itemId = await newConversationRecordId();
  const {conversation, created} = await insertIntegrationConversation({
    id: conversationId,
    workspaceId: params.workspaceId,
    projectId: args.projectId,
    agentKey: args.agentKey,
    origin: {
      connectionId: params.connectionId,
      provider: params.provider,
      key: interaction.conversationKey,
    },
    firstInput: {
      id: itemId,
      clientMessageId: messageId,
      sessionVersion: CONVERSATION_SESSION_VERSION,
      sealedEntry: sealConversationEntry({
        key,
        aad: aadForConversationItem({
          workspaceId: params.workspaceId,
          conversationId,
          itemId,
        }),
        entry: userMessageEntry({body: requestBody(params)}),
      }),
      meta: {role: 'user'},
    },
  });
  // Another delivery won the race for this key, so this one is a message to its owner.
  if (!created) return await deliverToOwner({params, owner: conversation, messageId, deps});

  await deps.wake(conversation.id);
  return startedResult({conversation, eligible: args.eligible});
}

/**
 * Why the project can't take an interaction from the connection. A deleted project and an
 * excluded connection are final, so neither is an error. A failure to read the policy is thrown for
 * the event to replay.
 */
async function projectDenial(args: {
  params: RouteInteractionParams;
  projectId: string;
  deps: Pick<RouteInteractionDeps, 'projects'>;
}): Promise<'project-access' | 'project-deleted' | undefined> {
  try {
    const {policy} = await args.deps.projects.getProjectAccessPolicy({
      workspaceId: args.params.workspaceId,
      projectId: args.projectId,
    });
    const decision = evaluateConnectionAccess(policy, {connectionId: args.params.connectionId});
    return decision.allowed ? undefined : 'project-access';
  } catch (error) {
    if (
      isInterModuleKnownError(projectsInterModuleContract.methods.getProjectAccessPolicy, error)
    ) {
      return 'project-deleted';
    }
    throw error;
  }
}

async function deliverToOwner(args: {
  params: RouteInteractionParams;
  owner: Conversation;
  messageId: string;
  deps: RouteInteractionDeps;
}): Promise<InteractionRoutingResult> {
  const {params, owner, messageId} = args;
  // The delivery that started the conversation is its first message, so a replay of it reports
  // how it started, not an owner hit.
  if (owner.clientMessageId === messageId) {
    const eligible = await eligibleCandidates({params, deps: args.deps});
    return startedResult({conversation: owner, eligible});
  }
  if (params.interaction.role === 'stop') {
    // The running turn ends at its next check and sends its own final reply. A stop with no
    // running turn has nothing to end.
    await requestTurnStop(owner.id);
    return routed('owner', owner);
  }

  const key = await conversationDataKey(owner.workspaceId);
  const itemId = await newConversationRecordId();
  const item = await insertQueuedUserMessage({
    id: itemId,
    conversationId: owner.id,
    authorUserId: null,
    clientMessageId: messageId,
    sessionVersion: CONVERSATION_SESSION_VERSION,
    sealedEntry: sealConversationEntry({
      key,
      aad: aadForConversationItem({
        workspaceId: owner.workspaceId,
        conversationId: owner.id,
        itemId,
      }),
      entry: userMessageEntry({body: requestBody(params)}),
    }),
    meta: {role: 'user'},
    resetRunBudget: params.interaction.author !== undefined,
  });
  // The owner was deleted after it was found, so nothing took the message.
  if (!item) return {outcome: 'dropped', reason: 'no-owner'};
  await args.deps.wake(owner.id);
  return routed('owner', owner);
}

/**
 * How a conversation this delivery started was routed: by the candidate that names its agent, with
 * the other eligible candidates as ambiguous, or by default. A replay recomputes it the same way.
 */
function startedResult(args: {
  conversation: Conversation;
  eligible: readonly InteractionRoutingCandidate[];
}): InteractionRoutingResult {
  const {conversation, eligible} = args;
  const winner = eligible.find(
    (candidate) =>
      candidate.projectId === conversation.projectId &&
      candidate.agentKey === conversation.agentKey,
  );
  if (!winner) return routed('default', conversation);
  return {
    outcome: 'matched',
    conversationId: conversation.id,
    projectId: conversation.projectId,
    agentKey: conversation.agentKey,
    subscriptionId: winner.subscriptionId,
    ambiguousSubscriptionIds: eligible
      .filter((candidate) => candidate !== winner)
      .map((candidate) => candidate.subscriptionId),
  };
}

function routed(
  outcome: 'owner' | 'default',
  conversation: Conversation,
): Extract<InteractionRoutingResult, {outcome: 'owner' | 'default'}> {
  return {
    outcome,
    conversationId: conversation.id,
    projectId: conversation.projectId,
    agentKey: conversation.agentKey,
  };
}

function requestBody(params: RouteInteractionParams): string {
  return wrapUntrustedText({
    source: params.provider.replace(/[^A-Za-z0-9_.-]/g, '_'),
    text: params.interaction.text,
    maxBytes: INTERACTION_TEXT_MAX_BYTES,
  });
}

/** The ID a message stores for its delivery, so a retry finds the message it already queued. */
export function deliveryMessageId(deliveryKey: string): string {
  const bytes = createHash('sha256').update(deliveryKey).digest().subarray(0, 16);
  // Version 5 and the RFC 4122 variant, so the value is a valid UUID.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

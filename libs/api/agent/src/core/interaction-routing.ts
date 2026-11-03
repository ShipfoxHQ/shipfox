import {createHash} from 'node:crypto';
import type {InteractionRoutingResult} from '@shipfox/api-agent-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  findIntegrationConversation,
  insertIntegrationConversation,
  insertQueuedUserMessage,
  newConversationRecordId,
} from '#db/conversations.js';
import {CONVERSATION_SESSION_VERSION, userMessageEntry} from './conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  sealConversationEntry,
} from './conversation-sealing.js';
import {SHIPPY_AGENT_KEY} from './conversations.js';
import type {Conversation} from './entities/conversation.js';
import {wrapUntrustedText} from './turn-runtime/tool-result.js';

/** The most a request stores. A model can't use more, and a thread can be read again with a tool. */
const INTERACTION_TEXT_MAX_BYTES = 64 * 1024;
const PROJECT_PAGE_SIZE = 100;

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
}

export interface RouteInteractionDeps {
  projects: Pick<ProjectsModuleClient, 'listProjectsByWorkspace'>;
  /** Tells the conversation to look at its inputs again. It never throws. */
  wake: (conversationId: string) => Promise<void>;
}

/**
 * Gives an interaction to the conversation that owns its key, or starts one with the default
 * agent for a request. A follow-up or stop with no owner is dropped, because only a request
 * starts a conversation. A stop reaches its owner without posting text.
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
  if (owner) return await deliverToOwner({params, owner, messageId, wake: deps.wake});
  if (interaction.role !== 'request') return {outcome: 'dropped', reason: 'no-owner'};

  const project = await findOldestProject(params.workspaceId, deps.projects);
  if (!project) return {outcome: 'dropped', reason: 'no-project'};

  const key = await conversationDataKey(params.workspaceId);
  const conversationId = await newConversationRecordId();
  const itemId = await newConversationRecordId();
  const {conversation, created} = await insertIntegrationConversation({
    id: conversationId,
    workspaceId: params.workspaceId,
    projectId: project.id,
    agentKey: SHIPPY_AGENT_KEY,
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
  if (!created)
    return await deliverToOwner({params, owner: conversation, messageId, wake: deps.wake});

  await deps.wake(conversation.id);
  return routed('default', conversation);
}

async function deliverToOwner(args: {
  params: RouteInteractionParams;
  owner: Conversation;
  messageId: string;
  wake: RouteInteractionDeps['wake'];
}): Promise<InteractionRoutingResult> {
  const {params, owner, messageId} = args;
  // The delivery that started the conversation is its first message, so a replay of it is not an
  // owner hit.
  const startedHere = owner.clientMessageId === messageId;
  const outcome = startedHere ? 'default' : 'owner';
  if (params.interaction.role === 'stop') return routed(outcome, owner);

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
  await args.wake(owner.id);
  return routed(outcome, owner);
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

/**
 * The default agent answers from the workspace's oldest project. Projects list newest first, so
 * the oldest is the last of the last page.
 */
async function findOldestProject(
  workspaceId: string,
  projects: RouteInteractionDeps['projects'],
): Promise<{id: string} | undefined> {
  let oldest: {id: string} | undefined;
  let cursor: Awaited<ReturnType<typeof projects.listProjectsByWorkspace>>['nextCursor'] = null;
  do {
    const page = await projects.listProjectsByWorkspace({
      workspaceId,
      limit: PROJECT_PAGE_SIZE,
      ...(cursor ? {cursor} : {}),
    });
    oldest = page.projects.at(-1) ?? oldest;
    cursor = page.nextCursor;
  } while (cursor);
  return oldest;
}

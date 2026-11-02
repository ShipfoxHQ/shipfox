import type {Buffer} from 'node:buffer';
import type {PageContextDto} from '@shipfox/api-agent-dto';
import type {TimestampIdCursor} from '@shipfox/node-drizzle';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  deleteConversationUnlessTurnRunning,
  insertQueuedUserMessage,
  insertWebConversation,
  listConversationTimeline,
  listWebConversations,
  newConversationRecordId,
} from '#db/conversations.js';
import {CONVERSATION_SESSION_VERSION, userMessageEntry} from './conversation-entries.js';
import {
  aadForConversationItem,
  aadForConversationTitle,
  conversationDataKey,
  openConversationEntry,
  openConversationText,
  sealConversationEntry,
  sealConversationText,
} from './conversation-sealing.js';
import type {
  Conversation,
  ConversationItem,
  OpenConversation,
  OpenConversationItem,
} from './entities/conversation.js';
import {
  AgentSessionUnavailableError,
  ConversationNotFoundError,
  ConversationTurnRunningError,
} from './errors.js';

const SHIPPY_AGENT_KEY = 'shippy';
const CONVERSATION_TITLE_MAX_CHARS = 80;
const CONVERSATION_QUEUED_ITEMS_CAP = 100;

export interface CreateWebConversationParams {
  workspaceId: string;
  projectId: string;
  ownerUserId: string;
  clientMessageId: string;
  body: string;
  pageContext?: PageContextDto | undefined;
}

export function conversationTitleFromMessage(body: string): string {
  const characters = Array.from(body.replace(/\s+/g, ' ').trim());
  return characters.slice(0, CONVERSATION_TITLE_MAX_CHARS).join('').trimEnd();
}

export function isConversationUnread(
  conversation: Pick<Conversation, 'lastAgentSeq' | 'lastReadSeq'>,
): boolean {
  return conversation.lastAgentSeq > conversation.lastReadSeq;
}

// Clients poll lists and timelines, so one unreadable row must not fail them all.
function openRow(
  open: () => string,
  row: {conversationId: string; itemId?: string},
): string | null {
  try {
    return open();
  } catch (error) {
    if (!(error instanceof AgentSessionUnavailableError)) throw error;
    logger().error({err: error, ...row}, 'Failed to open a sealed conversation row');
    reportError(error, {boundary: 'agent.conversation', extra: row});
    return null;
  }
}

function openConversation(conversation: Conversation, key: Buffer): OpenConversation {
  const {sealedTitle, ...rest} = conversation;
  const title =
    sealedTitle &&
    openRow(
      () =>
        openConversationText({
          key,
          aad: aadForConversationTitle({
            workspaceId: conversation.workspaceId,
            conversationId: conversation.id,
          }),
          sealed: sealedTitle,
        }),
      {conversationId: conversation.id},
    );
  return {...rest, title};
}

function openConversationItem(
  item: ConversationItem,
  params: {key: Buffer; workspaceId: string},
): OpenConversationItem {
  const {sealedEntry, ...rest} = item;
  const entry = openRow(
    () =>
      openConversationEntry({
        key: params.key,
        aad: aadForConversationItem({
          workspaceId: params.workspaceId,
          conversationId: item.conversationId,
          itemId: item.id,
        }),
        sealed: sealedEntry,
      }),
    {conversationId: item.conversationId, itemId: item.id},
  );
  return {...rest, entry};
}

function inputMeta(pageContext: PageContextDto | undefined) {
  return {role: 'user', ...(pageContext ? {page_context: pageContext} : {})};
}

export async function createWebConversation(
  params: CreateWebConversationParams,
): Promise<{conversation: OpenConversation; item: OpenConversationItem}> {
  const key = await conversationDataKey(params.workspaceId);
  const conversationId = await newConversationRecordId();
  const itemId = await newConversationRecordId();
  const scope = {workspaceId: params.workspaceId, conversationId};

  const created = await insertWebConversation({
    id: conversationId,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    agentKey: SHIPPY_AGENT_KEY,
    ownerUserId: params.ownerUserId,
    sealedTitle: sealConversationText({
      key,
      aad: aadForConversationTitle(scope),
      text: conversationTitleFromMessage(params.body),
    }),
    firstInput: {
      id: itemId,
      clientMessageId: params.clientMessageId,
      sessionVersion: CONVERSATION_SESSION_VERSION,
      sealedEntry: sealConversationEntry({
        key,
        aad: aadForConversationItem({...scope, itemId}),
        entry: userMessageEntry({body: params.body, pageContext: params.pageContext}),
      }),
      meta: inputMeta(params.pageContext),
    },
  });

  return {
    conversation: openConversation(created.conversation, key),
    item: openConversationItem(created.item, {key, workspaceId: params.workspaceId}),
  };
}

export async function postWebConversationMessage(params: {
  conversation: Conversation;
  authorUserId: string;
  clientMessageId: string;
  body: string;
  pageContext?: PageContextDto | undefined;
}): Promise<OpenConversationItem> {
  const {workspaceId, id: conversationId} = params.conversation;
  const key = await conversationDataKey(workspaceId);
  const itemId = await newConversationRecordId();

  const item = await insertQueuedUserMessage({
    id: itemId,
    conversationId,
    authorUserId: params.authorUserId,
    clientMessageId: params.clientMessageId,
    sessionVersion: CONVERSATION_SESSION_VERSION,
    sealedEntry: sealConversationEntry({
      key,
      aad: aadForConversationItem({workspaceId, conversationId, itemId}),
      entry: userMessageEntry({body: params.body, pageContext: params.pageContext}),
    }),
    meta: inputMeta(params.pageContext),
  });
  if (!item) throw new ConversationNotFoundError(conversationId);

  return openConversationItem(item, {key, workspaceId});
}

export async function listOpenWebConversations(params: {
  workspaceId: string;
  projectId: string;
  ownerUserId: string;
  limit: number;
  cursor?: TimestampIdCursor | undefined;
}): Promise<{
  conversations: OpenConversation[];
  nextCursor: TimestampIdCursor | null;
  unreadCount: number;
}> {
  const key = await conversationDataKey(params.workspaceId);
  const result = await listWebConversations(params);
  return {
    ...result,
    conversations: result.conversations.map((conversation) => openConversation(conversation, key)),
  };
}

export async function getOpenConversation(conversation: Conversation): Promise<OpenConversation> {
  return openConversation(conversation, await conversationDataKey(conversation.workspaceId));
}

export async function listOpenConversationItems(params: {
  conversation: Conversation;
  afterSeq?: number | undefined;
  beforeSeq?: number | undefined;
  limit: number;
}): Promise<{
  items: OpenConversationItem[];
  hasMore: boolean;
  queued: OpenConversationItem[];
  queuedHasMore: boolean;
}> {
  const {id: conversationId, workspaceId} = params.conversation;
  const key = await conversationDataKey(workspaceId);
  const timeline = await listConversationTimeline({
    conversationId,
    afterSeq: params.afterSeq,
    beforeSeq: params.beforeSeq,
    limit: params.limit,
    queuedLimit: CONVERSATION_QUEUED_ITEMS_CAP,
  });

  return {
    items: timeline.items.map((item) => openConversationItem(item, {key, workspaceId})),
    hasMore: timeline.hasMore,
    queued: timeline.queued.map((item) => openConversationItem(item, {key, workspaceId})),
    queuedHasMore: timeline.queuedHasMore,
  };
}

export async function deleteWebConversation(conversationId: string): Promise<void> {
  const outcome = await deleteConversationUnlessTurnRunning(conversationId);
  if (outcome === 'not-found') throw new ConversationNotFoundError(conversationId);
  if (outcome === 'turn-running') throw new ConversationTurnRunningError(conversationId);
}

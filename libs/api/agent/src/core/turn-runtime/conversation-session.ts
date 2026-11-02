import type {Buffer} from 'node:buffer';
import type {Message} from '@earendil-works/pi-ai';
import type {FileEntry, SessionEntry} from '@earendil-works/pi-coding-agent';
import {listContextItems} from '#db/turn-runtime.js';
import {parseConversationEntry} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import type {Conversation, ConversationItem} from '../entities/conversation.js';
import {AgentSessionUnavailableError, ConversationEntryUnreadableError} from '../errors.js';

type PiCodingAgent = typeof import('@earendil-works/pi-coding-agent');

interface OpenedRow {
  id: string;
  sessionVersion: number;
  entry: Record<string, unknown>;
}

function openRow(params: {item: ConversationItem; key: Buffer; workspaceId: string}): OpenedRow {
  const {item} = params;
  try {
    const text = openConversationEntry({
      key: params.key,
      aad: aadForConversationItem({
        workspaceId: params.workspaceId,
        conversationId: item.conversationId,
        itemId: item.id,
      }),
      sealed: item.sealedEntry,
    });
    const entry = parseConversationEntry(text);
    if (entry === undefined || typeof entry.type !== 'string') {
      throw new ConversationEntryUnreadableError(item.id);
    }
    return {id: item.id, sessionVersion: item.sessionVersion, entry};
  } catch (error) {
    if (error instanceof ConversationEntryUnreadableError) throw error;
    if (error instanceof AgentSessionUnavailableError) {
      throw new ConversationEntryUnreadableError(item.id, {cause: error});
    }
    throw error;
  }
}

/**
 * Brings rows written by an older pi session version to the current one, in memory. A row is
 * never rewritten, so a pi upgrade needs no data migration.
 */
function migrateRows(params: {pi: PiCodingAgent; conversationId: string; rows: OpenedRow[]}): void {
  const {pi, rows} = params;
  const outdated = new Set(
    rows.map((row) => row.sessionVersion).filter((version) => version < pi.CURRENT_SESSION_VERSION),
  );
  for (const version of outdated) {
    const group = rows.filter((row) => row.sessionVersion === version);
    const header = {
      type: 'session',
      version,
      id: params.conversationId,
      timestamp: new Date(0).toISOString(),
      cwd: '/',
    } as FileEntry;
    const entries = [header, ...group.map((row) => row.entry as unknown as FileEntry)];
    pi.migrateSessionEntries(entries);
    for (const [index, row] of group.entries()) {
      row.entry = entries[index + 1] as unknown as Record<string, unknown>;
    }
  }
}

/**
 * Turns stored rows into pi's session entries. The row ID is the entry ID, and a conversation has
 * no branches, so each entry's parent is the row before it.
 */
export function buildSessionEntries(params: {
  pi: PiCodingAgent;
  conversationId: string;
  rows: OpenedRow[];
}): SessionEntry[] {
  migrateRows(params);
  let parentId: string | null = null;
  return params.rows.map((row) => {
    const entry = {...row.entry, id: row.id, parentId} as unknown as SessionEntry;
    parentId = row.id;
    return entry;
  });
}

/**
 * Rebuilds the prompt of a conversation from its stored entries, starting at `context_start_seq`.
 * pi derives the messages, the system prompt, and the tools, so Agent assembles nothing itself.
 * A row that can't be opened fails the load.
 */
export async function loadConversationContext(params: {
  conversation: Conversation;
  pi?: PiCodingAgent | undefined;
}): Promise<Message[]> {
  const {conversation} = params;
  const pi = params.pi ?? (await import('@earendil-works/pi-coding-agent'));
  const [items, key] = await Promise.all([
    listContextItems({conversationId: conversation.id, fromSeq: conversation.contextStartSeq}),
    conversationDataKey(conversation.workspaceId),
  ]);
  const rows = items.map((item) => openRow({item, key, workspaceId: conversation.workspaceId}));
  const entries = buildSessionEntries({pi, conversationId: conversation.id, rows});

  const session = pi.SessionManager.inMemory('/', undefined, entries);
  return pi.convertToLlm(session.buildSessionContext().messages);
}

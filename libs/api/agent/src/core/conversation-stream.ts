import type {Buffer} from 'node:buffer';
import {setTimeout as sleep} from 'node:timers/promises';
import type {AgentTurnStatus} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type ConversationStreamSnapshot,
  listStreamChunks,
  readConversationStream,
  type StreamChunk,
  type StreamChunkCursor,
} from '#db/conversations.js';
import {conversationStreamTickSeconds} from '#metrics/index.js';
import {
  aadForTurnStreamChunk,
  conversationDataKey,
  openConversationText,
} from './conversation-sealing.js';
import {openConversationItem} from './conversations.js';
import type {AgentTurn, Conversation, OpenConversationItem} from './entities/conversation.js';
import {AgentSessionUnavailableError} from './errors.js';

// Measured on 2026-11-02 against a local Postgres 18 with 100 streams, each following a call that
// writes a chunk every 150 ms: tailing at 150 ms costs about 0.4 of a core, 20% of a 2 CU
// compute, with p95 tick latency of 24 ms and no change to chunk write latency. 250 streams
// cost about 1.2 cores, so relax the interval before the stream count nears 150.
export const STREAM_TAIL_INTERVAL_MS = 150;
export const STREAM_MAX_DURATION_MS = 5 * 60 * 1000;

type ConversationRef = Pick<Conversation, 'id' | 'workspaceId'>;

const STREAM_ITEMS_PER_READ = 100;
const STREAM_QUEUED_ITEMS_CAP = 100;

export type ConversationStreamEvent =
  | {type: 'queued'; item: OpenConversationItem}
  | {type: 'item'; item: OpenConversationItem}
  | {type: 'delta'; turnId: string; modelCallIndex: number; text: string}
  | {type: 'reset'; reason: 'reconnect' | 'retry'}
  | {type: 'turn'; turnId: string; status: AgentTurnStatus; failureCode: string | null};

export interface StreamConversationParams {
  conversation: ConversationRef;
  /** The last `seq` the reader holds. */
  afterSeq: number;
  signal: AbortSignal;
  intervalMs?: number | undefined;
  maxDurationMs?: number | undefined;
}

interface ChunkCursor extends StreamChunkCursor {
  /** Sealed bytes differ on every write, so they tell a chunk from one a retry rewrote. */
  sealedChunk: Buffer;
}

function isFinal(status: AgentTurnStatus): boolean {
  return status !== 'running';
}

function toCursor(turnId: string, chunk: StreamChunk): ChunkCursor {
  return {
    turnId,
    modelCallIndex: chunk.modelCallIndex,
    chunkSeq: chunk.chunkSeq,
    sealedChunk: chunk.sealedChunk,
  };
}

function isCursorChunk(chunk: StreamChunk | undefined, cursor: ChunkCursor): chunk is StreamChunk {
  return (
    chunk !== undefined &&
    chunk.modelCallIndex === cursor.modelCallIndex &&
    chunk.chunkSeq === cursor.chunkSeq &&
    chunk.sealedChunk.equals(cursor.sealedChunk)
  );
}

interface FollowedTurn {
  turnId: string;
  announced?: AgentTurnStatus;
}

/** What a reader holds, and what the next tick sends it. One instance serves one reader. */
class ConversationTail {
  private afterSeq: number;
  private readonly announcedQueued = new Set<string>();
  private followed: FollowedTurn | undefined;
  private ignoredTurnId: string | undefined;
  private cursor: ChunkCursor | undefined;
  private firstTick = true;

  constructor(
    private readonly conversation: ConversationRef,
    private readonly key: Buffer,
    afterSeq: number,
  ) {
    this.afterSeq = afterSeq;
  }

  get chunkCursor(): ChunkCursor | undefined {
    return this.cursor;
  }

  get itemsAfterSeq(): number {
    return this.afterSeq;
  }

  /** Turns a snapshot into the events the reader is missing. `done` ends the stream. */
  async tick(
    snapshot: ConversationStreamSnapshot,
  ): Promise<{events: ConversationStreamEvent[]; done: boolean}> {
    const turn = this.chooseTurn(snapshot);
    const events: ConversationStreamEvent[] = [];

    if (turn?.status === 'running' && this.followed?.announced !== 'running') {
      if (this.followed) this.followed.announced = 'running';
      events.push({type: 'turn', turnId: turn.id, status: 'running', failureCode: null});
      if (this.firstTick) events.push({type: 'reset', reason: 'reconnect'});
    }
    // Items come before text. A reader clears partial text on an item of the turn, so text of a
    // later call must not arrive ahead of the tool result that precedes it.
    events.push(...this.itemEvents(snapshot));
    if (turn?.status === 'running') events.push(...(await this.chunkEvents(turn.id, snapshot)));

    const done = this.isDone(snapshot, turn);
    if (done && turn && isFinal(turn.status)) {
      events.push({
        type: 'turn',
        turnId: turn.id,
        status: turn.status,
        failureCode: turn.failureCode,
      });
    }
    this.firstTick = false;
    return {events, done};
  }

  private chooseTurn(snapshot: ConversationStreamSnapshot): AgentTurn | undefined {
    const latest = snapshot.turn;
    if (!this.followed && latest && latest.id !== this.ignoredTurnId) {
      // A turn that already ended is not the one a queued input waits for.
      if (this.firstTick && latest.status !== 'running' && snapshot.queued.length > 0) {
        this.ignoredTurnId = latest.id;
      } else {
        this.followed = {turnId: latest.id};
      }
    }
    return this.followed && latest?.id === this.followed.turnId ? latest : undefined;
  }

  private isDone(snapshot: ConversationStreamSnapshot, turn: AgentTurn | undefined): boolean {
    if (snapshot.hasMore) return false;
    if (turn && isFinal(turn.status)) return true;
    if (!this.followed) return snapshot.queued.length === 0;
    // A newer turn replaced the one followed between two ticks, so its final status was missed.
    // The reader reconnects and reads the stored state.
    return !turn;
  }

  private async chunkEvents(
    turnId: string,
    snapshot: ConversationStreamSnapshot,
  ): Promise<ConversationStreamEvent[]> {
    const events: ConversationStreamEvent[] = [];
    let chunks = snapshot.chunks;
    const {cursor} = this;
    if (cursor?.turnId === turnId) {
      const [head, ...rest] = chunks;
      if (isCursorChunk(head, cursor)) {
        chunks = rest;
      } else if (snapshot.items.some((item) => isCallOf(item, cursor))) {
        // The reply replaced the call's chunks, and what is left belongs to a later call.
        this.cursor = undefined;
      } else {
        // The call started over, so its first chunks may sit below the cursor.
        this.cursor = undefined;
        events.push({type: 'reset', reason: 'retry'});
        chunks = await listStreamChunks(turnId);
      }
    }
    for (const chunk of chunks) {
      this.cursor = toCursor(turnId, chunk);
      const text = this.openText(turnId, chunk);
      if (text) events.push({type: 'delta', turnId, modelCallIndex: chunk.modelCallIndex, text});
    }
    return events;
  }

  private itemEvents(snapshot: ConversationStreamSnapshot): ConversationStreamEvent[] {
    const {workspaceId} = this.conversation;
    const events: ConversationStreamEvent[] = [];
    for (const item of snapshot.items) {
      events.push({type: 'item', item: openConversationItem(item, {key: this.key, workspaceId})});
      if (item.seq !== null) this.afterSeq = item.seq;
    }
    for (const item of snapshot.queued) {
      if (this.announcedQueued.has(item.id)) continue;
      this.announcedQueued.add(item.id);
      events.push({type: 'queued', item: openConversationItem(item, {key: this.key, workspaceId})});
    }
    return events;
  }

  private openText(turnId: string, chunk: StreamChunk): string | undefined {
    try {
      return openConversationText({
        key: this.key,
        aad: aadForTurnStreamChunk({
          workspaceId: this.conversation.workspaceId,
          conversationId: this.conversation.id,
          turnId,
          modelCallIndex: chunk.modelCallIndex,
          chunkSeq: chunk.chunkSeq,
        }),
        sealed: chunk.sealedChunk,
      });
    } catch (error) {
      if (!(error instanceof AgentSessionUnavailableError)) throw error;
      // Chunks only serve a live reader. The stored message is what counts.
      logger().warn(
        {err: error, conversationId: this.conversation.id},
        'Failed to open a stream chunk',
      );
      return undefined;
    }
  }
}

/**
 * Follows one turn of a conversation by tailing Postgres, so any API process can serve it
 * whichever process runs the turn. It sends the items after `afterSeq`, then the turn as it
 * runs: the running call's text as deltas, and each stored entry as an item. It ends when
 * the turn does, at the deadline, or when the reader leaves.
 *
 * With no turn running, it waits for one while inputs are queued, and ends at once otherwise.
 * A reader that connects mid-call gets a `reset` and that call's chunks from the first, so
 * chunks need no cursor of their own. A call that starts over sends `reset` again.
 */
export async function* streamConversation(
  params: StreamConversationParams,
): AsyncGenerator<ConversationStreamEvent> {
  const {conversation, signal} = params;
  const intervalMs = params.intervalMs ?? STREAM_TAIL_INTERVAL_MS;
  const deadline = Date.now() + (params.maxDurationMs ?? STREAM_MAX_DURATION_MS);
  const key = await conversationDataKey(conversation.workspaceId);
  const tail = new ConversationTail(conversation, key, params.afterSeq);

  while (!signal.aborted && Date.now() < deadline) {
    const tickStartedAt = performance.now();
    const snapshot = await readConversationStream({
      conversationId: conversation.id,
      afterSeq: tail.itemsAfterSeq,
      chunkCursor: tail.chunkCursor,
      limit: STREAM_ITEMS_PER_READ,
      queuedLimit: STREAM_QUEUED_ITEMS_CAP,
    });
    conversationStreamTickSeconds.record((performance.now() - tickStartedAt) / 1000);
    if (!snapshot.exists) return;

    const {events, done} = await tail.tick(snapshot);
    yield* events;
    if (done) return;

    // A full page of items means more are waiting, so the next read comes at once.
    const remainingMs = snapshot.hasMore ? 0 : intervalMs - (performance.now() - tickStartedAt);
    if (remainingMs > 0) await sleep(remainingMs, undefined, {signal}).catch(() => undefined);
  }
}

function isCallOf(
  item: {turnId: string | null; modelCallIndex: number | null},
  cursor: ChunkCursor,
): boolean {
  return item.turnId === cursor.turnId && item.modelCallIndex === cursor.modelCallIndex;
}

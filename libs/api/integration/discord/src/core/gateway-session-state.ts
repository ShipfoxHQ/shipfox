import type {SessionInfo} from '@discordjs/ws';
import type {DiscordGatewaySession} from '#db/gateway-sessions.js';

export const GATEWAY_SHARD_ID = 0;
export const GATEWAY_SHARD_COUNT = 1;

export interface GatewaySessionSnapshot {
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  receivedSequence: number;
  committedSequence: number;
}

/**
 * The highest sequence at or below which every dispatch was handled. The library can emit
 * dispatches out of order (`READY` after `GUILD_CREATE`), so a handled sequence above a gap waits
 * until the gap is filled.
 */
export class ContiguousMark {
  #mark: number;
  readonly #handledAboveMark = new Set<number>();

  constructor(mark = 0) {
    this.#mark = mark;
  }

  get value(): number {
    return this.#mark;
  }

  reset(mark: number): void {
    this.#mark = mark;
    this.#handledAboveMark.clear();
  }

  /** Returns true when the mark moved. */
  handled(sequence: number): boolean {
    if (sequence <= this.#mark) return false;
    this.#handledAboveMark.add(sequence);
    const before = this.#mark;
    while (this.#handledAboveMark.delete(this.#mark + 1)) this.#mark++;
    return this.#mark !== before;
  }
}

/**
 * The library calls both hooks on every dispatch and heartbeat and does not serialize frames, so
 * they stay synchronous and in memory. The row is written from a timer, never from a hook.
 */
export class GatewaySessionState {
  #sessionId: string | null;
  #resumeGatewayUrl: string | null;
  #receivedSequence: number;
  readonly #mark: ContiguousMark;
  #epoch = 0;
  #version = 0;
  #ownDestroyDepth = 0;
  readonly #onSessionChange: () => void;

  constructor(params: {stored?: DiscordGatewaySession | undefined; onSessionChange: () => void}) {
    const {stored} = params;
    const resumable = stored?.sessionId && stored.resumeGatewayUrl;
    this.#sessionId = resumable ? (stored.sessionId ?? null) : null;
    this.#resumeGatewayUrl = resumable ? (stored.resumeGatewayUrl ?? null) : null;
    this.#receivedSequence = resumable ? (stored.receivedSequence ?? 0) : 0;
    this.#mark = new ContiguousMark(resumable ? (stored.committedSequence ?? 0) : 0);
    this.#onSessionChange = params.onSessionChange;
  }

  /** Changes on every new or cleared session. A dispatch from an earlier epoch is stale. */
  get epoch(): number {
    return this.#epoch;
  }

  /** Changes on every mutation, so a flush can skip an unchanged state. */
  get version(): number {
    return this.#version;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  snapshot(): GatewaySessionSnapshot {
    return {
      sessionId: this.#sessionId,
      resumeGatewayUrl: this.#resumeGatewayUrl,
      receivedSequence: this.#receivedSequence,
      committedSequence: this.#mark.value,
    };
  }

  /** Marks a dispatch as published or skipped on purpose. Stale epochs are ignored. */
  commit(params: {sequence: number; epoch: number}): void {
    if (params.epoch !== this.#epoch) return;
    if (this.#mark.handled(params.sequence)) this.#version++;
  }

  /** Runs a destroy whose `null` session write must not clear the stored session. */
  async keepingSession<T>(fn: () => Promise<T>): Promise<T> {
    this.#ownDestroyDepth++;
    try {
      return await fn();
    } finally {
      this.#ownDestroyDepth--;
    }
  }

  /** `retrieveSessionInfo`: the committed mark, never the received sequence, is the resume point. */
  retrieve = (shardId: number): SessionInfo | null => {
    if (!this.#sessionId || !this.#resumeGatewayUrl) return null;
    return {
      sessionId: this.#sessionId,
      resumeURL: this.#resumeGatewayUrl,
      sequence: this.#mark.value,
      shardCount: GATEWAY_SHARD_COUNT,
      shardId,
    };
  };

  /** `updateSessionInfo`: sets the session fields and the received sequence, never the mark. */
  update = (_shardId: number, info: SessionInfo | null): void => {
    if (info === null) {
      if (this.#ownDestroyDepth > 0 || this.#sessionId === null) return;
      this.#startEpoch({sessionId: null, resumeGatewayUrl: null, receivedSequence: 0});
      return;
    }
    if (info.sessionId !== this.#sessionId) {
      this.#startEpoch({
        sessionId: info.sessionId,
        resumeGatewayUrl: info.resumeURL,
        receivedSequence: info.sequence,
      });
      return;
    }
    this.#resumeGatewayUrl = info.resumeURL;
    this.#receivedSequence = Math.max(this.#receivedSequence, info.sequence);
    this.#version++;
  };

  #startEpoch(params: {
    sessionId: string | null;
    resumeGatewayUrl: string | null;
    receivedSequence: number;
  }): void {
    this.#sessionId = params.sessionId;
    this.#resumeGatewayUrl = params.resumeGatewayUrl;
    this.#receivedSequence = params.receivedSequence;
    this.#mark.reset(0);
    this.#epoch++;
    this.#version++;
    this.#onSessionChange();
  }
}

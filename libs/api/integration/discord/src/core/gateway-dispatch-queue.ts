import type {GatewayDispatchPayload as LibraryDispatchPayload} from 'discord-api-types/v10';
import {type DiscordGatewayDispatchEvent, recordDiscordGatewayDispatch} from '#metrics/index.js';
import type {GatewaySessionState} from './gateway-session-state.js';

export type GatewayDispatchPayload = LibraryDispatchPayload;

const DISPATCH_EVENT_LABELS: Partial<Record<string, DiscordGatewayDispatchEvent>> = {
  MESSAGE_CREATE: 'message_create',
  MESSAGE_REACTION_ADD: 'message_reaction_add',
};

/** A handler publishes the dispatch or decides it needs nothing. Throwing ends the manager. */
export type DispatchHandler = (payload: GatewayDispatchPayload) => Promise<void> | void;

/** Handlers by dispatch name, such as `MESSAGE_CREATE`. A dispatch without one is skipped. */
export type DispatchHandlers = Partial<Record<string, DispatchHandler>>;

/**
 * Handles dispatches in emit order, one at a time, and moves the committed mark only after a
 * handler finished. A failure stops the queue and drops what is left: the mark stays below the
 * failed dispatch, so a new manager resumes and Discord replays it.
 */
export class DispatchQueue {
  readonly #pending: {payload: GatewayDispatchPayload; epoch: number}[] = [];
  readonly #state: GatewaySessionState;
  readonly #handlers: DispatchHandlers;
  readonly #onFailure: (error: Error) => void;
  #draining = false;
  #dropped = false;

  constructor(params: {
    state: GatewaySessionState;
    handlers: DispatchHandlers;
    onFailure: (error: Error) => void;
  }) {
    this.#state = params.state;
    this.#handlers = params.handlers;
    this.#onFailure = params.onFailure;
  }

  push(payload: GatewayDispatchPayload): void {
    if (this.#dropped) return;
    this.#pending.push({payload, epoch: this.#state.epoch});
    void this.#drain();
  }

  drop(): void {
    this.#dropped = true;
    this.#pending.length = 0;
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    let currentType = '';
    try {
      while (!this.#dropped) {
        const item = this.#pending.shift();
        if (!item) return;
        if (item.epoch !== this.#state.epoch) continue;
        currentType = item.payload.t;
        await this.#handlers[item.payload.t]?.(item.payload);
        if (this.#dropped) return;
        this.#state.commit({sequence: item.payload.s, epoch: item.epoch});
      }
    } catch (error) {
      const event = DISPATCH_EVENT_LABELS[currentType];
      if (event) recordDiscordGatewayDispatch({event, outcome: 'failed'});
      this.drop();
      this.#onFailure(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#draining = false;
    }
  }
}

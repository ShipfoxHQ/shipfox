import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {
  ConversationDetailDto,
  ConversationItemDto,
  ConversationLatestTurnDto,
  CreateConversationResponseDto,
  ListConversationItemsResponseDto,
  PageContextDto,
} from '@shipfox/api-agent-dto';
import type {createApiClient} from '@shipfox/e2e-core';

const POLL_INTERVAL_MS = 500;
const ITEMS_PAGE_SIZE = 100;

type ApiClient = ReturnType<typeof createApiClient>;

export interface ShippyToolCall {
  turn_id: string | null;
  name: string;
  /** The arguments as the model sent them, JSON-encoded. */
  input: string;
}

export interface ShippyToolResult {
  turn_id: string | null;
  name: string;
  is_error: boolean;
}

/** What the conversation shows after its last turn, read through the public API. */
export interface ShippyTranscript {
  turns: ConversationLatestTurnDto[];
  tool_calls: ShippyToolCall[];
  tool_results: ShippyToolResult[];
  /** The assistant text of the last turn, which is the reply the user reads. */
  reply: string;
  items: ConversationItemDto[];
}

/**
 * A web conversation with Shippy, driven the way the chat panel drives it: each message waits for
 * the turn it starts to end.
 */
export class ShippyConversation {
  readonly #client: ApiClient;
  readonly #projectId: string;
  #conversationId: string | undefined;
  readonly #turns: ConversationLatestTurnDto[] = [];

  constructor(params: {client: ApiClient; projectId: string}) {
    this.#client = params.client;
    this.#projectId = params.projectId;
  }

  get id(): string | undefined {
    return this.#conversationId;
  }

  /** Sends a message, then waits for the turn it starts to end, and returns that turn. */
  async say(params: {
    body: string;
    pageContext?: PageContextDto | undefined;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  }): Promise<ConversationLatestTurnDto> {
    const previousTurnId = this.#turns.at(-1)?.id;
    const json = {
      client_message_id: randomUUID(),
      body: params.body,
      ...(params.pageContext === undefined ? {} : {page_context: params.pageContext}),
    };
    if (this.#conversationId === undefined) {
      const created = await this.#client.requestJson<CreateConversationResponseDto>(
        'post',
        `/projects/${this.#projectId}/conversations`,
        {json},
      );
      this.#conversationId = created.conversation.id;
    } else {
      await this.#client.request('post', `/conversations/${this.#conversationId}/messages`, {json});
    }
    const turn = await this.#waitForTurnAfter({
      previousTurnId,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    });
    this.#turns.push(turn);
    return turn;
  }

  async transcript(): Promise<ShippyTranscript> {
    const items = this.#conversationId === undefined ? [] : await this.#readItems();
    const lastTurnId = this.#turns.at(-1)?.id;
    return {turns: [...this.#turns], ...summarizeItems({items, lastTurnId}), items};
  }

  // A new message wakes the conversation through Temporal, so right after the post the latest
  // turn can still be the previous one, or none.
  async #waitForTurnAfter(params: {
    previousTurnId: string | undefined;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  }): Promise<ConversationLatestTurnDto> {
    const deadline = Date.now() + params.timeoutMs;
    let last: ConversationLatestTurnDto | null = null;
    while (Date.now() < deadline) {
      params.signal?.throwIfAborted();
      const detail = await this.#client.requestJson<ConversationDetailDto>(
        'get',
        `/conversations/${this.#conversationId}`,
      );
      last = detail.latest_turn;
      if (
        last !== null &&
        last.id !== params.previousTurnId &&
        last.status !== 'running' &&
        detail.active_turn === null
      ) {
        return last;
      }
      await delay(POLL_INTERVAL_MS, undefined, {signal: params.signal});
    }
    const seen = last === null ? 'no turn' : `turn ${last.id} ${last.status}`;
    throw new Error(`Timed out after ${params.timeoutMs}ms waiting for Shippy's turn: ${seen}`);
  }

  async #readItems(): Promise<ConversationItemDto[]> {
    const items: ConversationItemDto[] = [];
    let afterSeq = 0;
    while (true) {
      const page = await this.#client.requestJson<ListConversationItemsResponseDto>(
        'get',
        `/conversations/${this.#conversationId}/items?after_seq=${afterSeq}&limit=${ITEMS_PAGE_SIZE}`,
      );
      items.push(...page.items);
      const lastSeq = page.items.at(-1)?.seq;
      if (!page.has_more || lastSeq === undefined || lastSeq === null) return items;
      afterSeq = lastSeq;
    }
  }
}

/** The tool activity of the whole conversation, and the assistant text of its last turn. */
export function summarizeItems(params: {
  items: readonly ConversationItemDto[];
  lastTurnId: string | undefined;
}): Pick<ShippyTranscript, 'tool_calls' | 'tool_results' | 'reply'> {
  const toolCalls: ShippyToolCall[] = [];
  const toolResults: ShippyToolResult[] = [];
  const reply: string[] = [];
  for (const item of params.items) {
    if (item.content?.type !== 'rows') continue;
    for (const row of item.content.rows) {
      if (row.kind === 'tool-call') {
        toolCalls.push({turn_id: item.turn_id, name: row.name, input: row.input});
      } else if (row.kind === 'tool-result') {
        toolResults.push({turn_id: item.turn_id, name: row.toolName, is_error: row.isError});
      } else if (
        row.kind === 'message' &&
        row.role === 'assistant' &&
        item.turn_id !== null &&
        item.turn_id === params.lastTurnId
      ) {
        reply.push(row.text);
      }
    }
  }
  return {tool_calls: toolCalls, tool_results: toolResults, reply: reply.join('\n\n').trim()};
}

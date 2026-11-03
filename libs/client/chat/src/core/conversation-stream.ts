export type ConversationTurnStatus = 'running' | 'succeeded' | 'failed' | 'stopped';

/** What the reducer needs from a timeline item. The adapter chooses the rest. */
export interface StreamedItem {
  id: string;
  /** Null while the item is queued. A claim assigns it. */
  seq: number | null;
  /** Null for an input. A turn's entries carry the turn. */
  turnId: string | null;
}

export type ConversationStreamEvent<TItem extends StreamedItem> =
  | {kind: 'queued'; item: TItem}
  | {kind: 'item'; item: TItem}
  | {kind: 'text'; text: string}
  | {kind: 'reset'}
  | {kind: 'turn'; turnId: string; status: ConversationTurnStatus; failureCode: string | null}
  /** The connection dropped. The stream reconnects on its own. */
  | {kind: 'dropped'};

export interface ConversationStreamState<TItem extends StreamedItem> {
  /** Claimed items in `seq` order, each once. */
  items: readonly TItem[];
  /** Inputs the agent has not claimed yet. */
  queued: readonly TItem[];
  /** Text of the running model call. The stored reply replaces it. */
  partialText: string;
  turn: {turnId: string; status: ConversationTurnStatus; failureCode: string | null} | undefined;
  /** The highest `seq` held. A reconnect asks for the items after it. */
  lastSeq: number;
  /** The connection dropped, and no event has arrived since. */
  reconnecting: boolean;
}

export function createConversationStreamState<TItem extends StreamedItem>(
  lastSeq = 0,
): ConversationStreamState<TItem> {
  return {items: [], queued: [], partialText: '', turn: undefined, lastSeq, reconnecting: false};
}

export function isFinalTurnStatus(status: ConversationTurnStatus): boolean {
  return status !== 'running';
}

function withItem<TItem extends StreamedItem>(
  state: ConversationStreamState<TItem>,
  item: TItem,
): ConversationStreamState<TItem> {
  const queued = state.queued.filter((candidate) => candidate.id !== item.id);
  if (item.seq === null || state.items.some((candidate) => candidate.id === item.id)) {
    return {...state, queued};
  }
  const items = [...state.items, item].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  // Every entry a turn stores ends the partial text. The stored reply holds the whole of it,
  // and the server sends an item before the text of the call that follows it.
  const partialText = item.turnId === null ? state.partialText : '';
  return {...state, items, queued, partialText, lastSeq: Math.max(state.lastSeq, item.seq)};
}

/**
 * Applies one stream event. Every event is safe to apply twice, because a reconnect sends the
 * items after the cursor again, and the running call's text from its first chunk after a reset.
 */
export function reduceConversationStream<TItem extends StreamedItem>(
  current: ConversationStreamState<TItem>,
  event: ConversationStreamEvent<TItem>,
): ConversationStreamState<TItem> {
  if (event.kind === 'dropped') {
    return current.reconnecting ? current : {...current, reconnecting: true};
  }
  const state = current.reconnecting ? {...current, reconnecting: false} : current;
  switch (event.kind) {
    case 'queued': {
      const known = [...state.items, ...state.queued].some((item) => item.id === event.item.id);
      return known ? state : {...state, queued: [...state.queued, event.item]};
    }
    case 'item':
      return withItem(state, event.item);
    case 'text':
      return {...state, partialText: state.partialText + event.text};
    case 'reset':
      return {...state, partialText: ''};
    case 'turn':
      return {
        ...state,
        turn: {turnId: event.turnId, status: event.status, failureCode: event.failureCode},
        // A failed call stores no reply, so its text goes with the turn.
        partialText: isFinalTurnStatus(event.status) ? '' : state.partialText,
      };
  }
}

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 8_000;

/** Waits longer after each failure in a row, up to a cap. */
export function reconnectDelayMs(failuresInARow: number): number {
  return Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** Math.max(failuresInARow - 1, 0),
    RECONNECT_MAX_DELAY_MS,
  );
}

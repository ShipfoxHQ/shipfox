import type {OutboxTable} from './schema.js';
import type {EventMapLike, EventType} from './types.js';

type OutboxRow = {eventType: string; payload: unknown};

interface DrizzleInsertable {
  insert: (table: OutboxTable) => {
    values: {
      (value: OutboxRow): Promise<unknown>;
      (values: OutboxRow[]): Promise<unknown>;
    };
  };
}

type OutboxEvent<TMap extends EventMapLike> = {
  [K in EventType<TMap>]: {type: K; payload: TMap[K]};
}[EventType<TMap>];

export async function writeOutboxEvent<TMap extends EventMapLike>(
  tx: DrizzleInsertable,
  outboxTable: OutboxTable,
  event: OutboxEvent<TMap>,
): Promise<void> {
  await writeOutboxEvents<TMap>(tx, outboxTable, [event]);
}

export async function writeOutboxEvents<TMap extends EventMapLike>(
  tx: DrizzleInsertable,
  outboxTable: OutboxTable,
  events: Array<OutboxEvent<TMap>>,
): Promise<void> {
  // Drizzle's `.values([])` emits invalid SQL, so an empty batch is a no-op.
  if (events.length === 0) return;

  await tx.insert(outboxTable).values(
    events.map((event) => ({
      eventType: event.type,
      payload: event.payload,
    })),
  );
}

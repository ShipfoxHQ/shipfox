import type {OutboxTable, PostgresOutboxTable} from './schema.js';
import type {EventMapLike, EventType, IdempotentOutboxEvent, OutboxWriteResult} from './types.js';

type OutboxRow = {eventType: string; orderingKey: string | null; payload: unknown};

interface DrizzleInsertable {
  insert: (table: OutboxTable) => {
    values: {
      (value: OutboxRow): Promise<unknown>;
      (values: OutboxRow[]): Promise<unknown>;
    };
  };
}

interface IdempotentDrizzleInsertable {
  insert: (table: PostgresOutboxTable) => {
    values: (value: {
      idempotencyKey: string;
      eventType: string;
      orderingKey: string | null;
      payload: unknown;
      createdAt?: Date | undefined;
      nextDispatchAt?: Date | undefined;
    }) => {
      onConflictDoNothing: (options: {target: PostgresOutboxTable['idempotencyKey']}) => {
        returning: (fields: {id: PostgresOutboxTable['id']}) => Promise<Array<{id: string}>>;
      };
    };
  };
}

type OutboxEvent<TMap extends EventMapLike> = {
  [K in EventType<TMap>]: {type: K; orderingKey?: string | undefined; payload: TMap[K]};
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
      orderingKey: normalizeKey(event.orderingKey),
      payload: event.payload,
    })),
  );
}

/**
 * Inserts an event through the caller's Drizzle transaction.
 * A repeated idempotency key leaves the first durable event unchanged.
 */
export async function writeIdempotentOutboxEvent<TPayload>(
  tx: IdempotentDrizzleInsertable,
  outboxTable: PostgresOutboxTable,
  event: IdempotentOutboxEvent<TPayload>,
): Promise<OutboxWriteResult> {
  const idempotencyKey = normalizeRequiredKey(event.idempotencyKey, 'idempotencyKey');
  const eventType = normalizeRequiredKey(event.type, 'type');
  const inserted = await tx
    .insert(outboxTable)
    .values({
      idempotencyKey,
      eventType,
      orderingKey: normalizeKey(event.orderingKey),
      payload: event.payload,
      ...(event.createdAt ? {createdAt: event.createdAt} : {}),
      ...(event.availableAt ? {nextDispatchAt: event.availableAt} : {}),
    })
    .onConflictDoNothing({target: outboxTable.idempotencyKey})
    .returning({id: outboxTable.id});

  return {status: inserted.length === 0 ? 'duplicate' : 'created'};
}

function normalizeKey(key: string | undefined): string | null {
  const trimmed = key?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredKey(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  return normalized;
}

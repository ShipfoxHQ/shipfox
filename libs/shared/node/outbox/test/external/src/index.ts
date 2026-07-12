import {randomUUID} from 'node:crypto';
import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {
  createPostgresOutbox,
  createPostgresOutboxTable,
  writeIdempotentOutboxEvent,
} from '@shipfox/node-outbox';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {pgTableCreator} from 'drizzle-orm/pg-core';

interface GlintDelivery {
  eventId: string;
  type: string;
  payload: unknown;
  attempt: number;
  lease: {token: string; expiresAt: Date};
}

interface GlintOutboxHealth {
  pending: number;
  oldestPendingAgeMs?: number;
}

interface GlintOutboxPort {
  claim(batchSize: number): Promise<Array<GlintDelivery>>;
  acknowledge(delivery: GlintDelivery): Promise<void>;
  retry(
    delivery: GlintDelivery,
    failure: unknown,
  ): Promise<'scheduled' | 'dead-lettered' | 'stale'>;
  health(): Promise<GlintOutboxHealth>;
}

class ShipfoxOutboxAdapter implements GlintOutboxPort {
  readonly #outbox: ReturnType<typeof createPostgresOutbox>;

  constructor(database: NodePgDatabase, table: ReturnType<typeof createPostgresOutboxTable>) {
    this.#outbox = createPostgresOutbox({database, table});
  }

  async claim(batchSize: number) {
    const deliveries = await this.#outbox.claim({batchSize, leaseDurationMs: 30_000});
    return deliveries.map((delivery) => ({
      eventId: delivery.id,
      type: delivery.type,
      payload: delivery.payload,
      attempt: delivery.attempts,
      lease: {token: delivery.leaseToken, expiresAt: delivery.leaseExpiresAt},
    }));
  }

  async acknowledge(delivery: GlintDelivery) {
    const result = await this.#outbox.acknowledge({
      id: delivery.eventId,
      leaseToken: delivery.lease.token,
    });
    if (result.status !== 'acknowledged') throw new Error('Expected a current delivery lease');
  }

  async retry(delivery: GlintDelivery, failure: unknown) {
    const result = await this.#outbox.retry({
      id: delivery.eventId,
      leaseToken: delivery.lease.token,
      delayMs: 1_000,
      failure,
    });
    if (result.status === 'retry-scheduled') return 'scheduled';
    return result.status;
  }

  async health() {
    const health = await this.#outbox.health();
    return {
      pending: health.pendingCount,
      ...(health.oldestPendingAgeMs === undefined
        ? {}
        : {oldestPendingAgeMs: health.oldestPendingAgeMs}),
    };
  }
}

const suffix = randomUUID().replaceAll('-', '');
const tableName = `node_outbox_external_${suffix}`;
const pool = createPostgresClient();
const database = drizzle(pool);
const table = createPostgresOutboxTable(pgTableCreator(() => tableName));
const availableAt = new Date(Date.now() - 60_000);

try {
  await pool.query(`
    CREATE TABLE "${tableName}" (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      idempotency_key text NOT NULL,
      event_type text NOT NULL,
      ordering_key text,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      dispatched_at timestamptz,
      dispatch_attempts integer NOT NULL DEFAULT 0,
      next_dispatch_at timestamptz NOT NULL DEFAULT now(),
      lease_token uuid,
      lease_expires_at timestamptz,
      last_dispatch_error jsonb,
      last_dispatch_failed_at timestamptz,
      dead_lettered_at timestamptz
    );
    CREATE UNIQUE INDEX "${tableName}_idempotency_key_idx" ON "${tableName}" (idempotency_key);
    CREATE UNIQUE INDEX "${tableName}_lease_token_idx" ON "${tableName}" (lease_token);
    CREATE INDEX "${tableName}_pending_idx" ON "${tableName}" (next_dispatch_at, created_at, id)
      WHERE dispatched_at IS NULL AND dead_lettered_at IS NULL;
  `);

  await database.transaction(async (tx) => {
    const result = await writeIdempotentOutboxEvent(tx, table, {
      idempotencyKey: 'build-created:build-1',
      type: 'build.created',
      payload: {buildId: 'build-1'},
      availableAt,
    });
    if (result.status !== 'created') throw new Error('Expected a new durable event');
  });

  const outbox: GlintOutboxPort = new ShipfoxOutboxAdapter(database, table);
  const [delivery] = await outbox.claim(1);
  if (!delivery) throw new Error('Expected the external consumer to claim its event');
  await outbox.acknowledge(delivery);
  const health = await outbox.health();
  if (health.pending !== 0) throw new Error('Expected no pending events after delivery');
} finally {
  await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
  await closePostgresClient();
}

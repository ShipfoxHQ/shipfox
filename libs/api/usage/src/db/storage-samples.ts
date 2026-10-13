import {
  MAX_STORAGE_SAMPLES_BATCH_SIZE,
  MAX_USAGE_REPLAY_LIMIT,
  type StorageSampleInputDto,
  type StorageSampleUsageDto,
  storageSampleInputSchema,
  USAGE_STORAGE_SAMPLE_RECORDED,
  type UsageEventMap,
} from '@shipfox/api-usage-dto';
import {writeOutboxEvents} from '@shipfox/node-outbox';
import {and, asc, eq, gt, gte, or, type SQL, sql} from 'drizzle-orm';
import {db, type Transaction} from './db.js';
import {usageOutbox} from './schema/outbox.js';
import {usageStorageSamples} from './schema/storage-samples.js';

export type UsageStorageSampleRow = typeof usageStorageSamples.$inferSelect;

export interface StorageSampleUsageCursor {
  recordedAt: Date;
  id: string;
}

export interface ListStorageSamplesParams {
  workspaceId?: string | undefined;
  since?: Date | undefined;
  cursor?: StorageSampleUsageCursor | undefined;
  limit?: number | undefined;
}

export interface ListStorageSamplesResult {
  samples: UsageStorageSampleRow[];
  nextCursor: StorageSampleUsageCursor | null;
}

export function recordStorageSamples(params: {
  samples: readonly StorageSampleInputDto[];
  now?: Date;
}): Promise<{recorded: number; duplicates: number}> {
  if (params.samples.length > MAX_STORAGE_SAMPLES_BATCH_SIZE) {
    throw new Error(
      `Storage sample batches cannot contain more than ${MAX_STORAGE_SAMPLES_BATCH_SIZE} samples`,
    );
  }
  if (params.samples.length === 0) {
    return Promise.resolve({recorded: 0, duplicates: 0});
  }
  const samples = params.samples.map((sample) => storageSampleInputSchema.parse(sample));

  return db().transaction(async (tx) => {
    const events: Array<{
      type: typeof USAGE_STORAGE_SAMPLE_RECORDED;
      orderingKey: string;
      payload: ReturnType<typeof toRecordedStorageSample>;
    }> = [];
    let duplicates = 0;
    const recordedAt = params.now ?? new Date();

    const sampleKeys = [...new Set(samples.map((sample) => sample.sampleKey))].sort();
    for (const sampleKey of sampleKeys) {
      await lockSample(tx, sampleKey);
    }

    for (const sample of samples) {
      const [existing] = await tx
        .select({id: usageStorageSamples.id})
        .from(usageStorageSamples)
        .where(eq(usageStorageSamples.sampleKey, sample.sampleKey));
      if (existing) {
        duplicates += 1;
        continue;
      }

      const [row] = await tx
        .insert(usageStorageSamples)
        .values({
          sampleKey: sample.sampleKey,
          source: sample.source,
          workspaceId: sample.workspaceId,
          projectId: sample.projectId,
          windowStart: new Date(sample.windowStart),
          windowEnd: new Date(sample.windowEnd),
          storedBytes: sample.storedBytes,
          objectCount: sample.objectCount,
          recordedAt,
        })
        .returning();
      if (!row) throw new Error('Usage storage sample was not inserted');
      events.push({
        type: USAGE_STORAGE_SAMPLE_RECORDED,
        orderingKey: row.projectId,
        payload: toRecordedStorageSample(row),
      });
    }

    await writeOutboxEvents<UsageEventMap>(tx, usageOutbox, events);
    return {recorded: events.length, duplicates};
  });
}

export async function listStorageSamples(
  params: ListStorageSamplesParams,
): Promise<ListStorageSamplesResult> {
  const limit = params.limit ?? MAX_USAGE_REPLAY_LIMIT;
  const conditions: SQL[] = [];
  if (params.workspaceId) {
    conditions.push(eq(usageStorageSamples.workspaceId, params.workspaceId));
  }
  if (params.since) conditions.push(gte(usageStorageSamples.recordedAt, params.since));
  if (params.cursor) {
    const cursorCondition = or(
      gt(usageStorageSamples.recordedAt, params.cursor.recordedAt),
      and(
        eq(usageStorageSamples.recordedAt, params.cursor.recordedAt),
        gt(usageStorageSamples.id, params.cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await db()
    .select()
    .from(usageStorageSamples)
    .where(and(...conditions))
    .orderBy(asc(usageStorageSamples.recordedAt), asc(usageStorageSamples.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page.at(-1) : undefined;
  return {
    samples: page,
    nextCursor: last ? {recordedAt: last.recordedAt, id: last.id} : null,
  };
}

export function toRecordedStorageSample(
  row: UsageStorageSampleRow,
): StorageSampleUsageDto & {version: 1} {
  return {version: 1, ...toStorageSampleUsage(row)};
}

export function toStorageSampleUsage(row: UsageStorageSampleRow): StorageSampleUsageDto {
  return {
    id: row.id,
    sampleKey: row.sampleKey,
    source: row.source,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    storedBytes: row.storedBytes,
    objectCount: row.objectCount,
    recordedAt: row.recordedAt.toISOString(),
  };
}

async function lockSample(tx: Transaction, sampleKey: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sampleKey}))`);
}

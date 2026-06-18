import {and, eq, isNull, sql} from 'drizzle-orm';
import type {Transaction} from './db.js';
import {jobAccounting} from './schema/job-accounting.js';

/** Creates the per-job accounting row on first append; a no-op once it exists. */
export async function ensureJobAccounting(
  tx: Transaction,
  params: {jobId: string; workspaceId: string},
): Promise<void> {
  await tx
    .insert(jobAccounting)
    .values({jobId: params.jobId, workspaceId: params.workspaceId})
    .onConflictDoNothing({target: jobAccounting.jobId});
}

export interface AccrualResult {
  used: number;
  startedAt: Date;
}

/**
 * Atomically adds `delta` stored bytes to the job's accrual, returning the new
 * total and the budget clock origin. Returns null when the job is already capped
 * (the `capped_at IS NULL` guard matched no row), so the caller drops the append.
 */
export async function accrueStoredBytes(
  tx: Transaction,
  params: {jobId: string; delta: number},
): Promise<AccrualResult | null> {
  const [row] = await tx
    .update(jobAccounting)
    .set({
      storedBytesUsed: sql`${jobAccounting.storedBytesUsed} + ${params.delta}`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobAccounting.jobId, params.jobId), isNull(jobAccounting.cappedAt)))
    .returning({used: jobAccounting.storedBytesUsed, startedAt: jobAccounting.startedAt});

  return row ?? null;
}

/** Claims the cap for a job. Returns true for the single caller that wins the race. */
export async function claimCap(tx: Transaction, jobId: string): Promise<boolean> {
  const [row] = await tx
    .update(jobAccounting)
    .set({cappedAt: sql`now()`, updatedAt: sql`now()`})
    .where(and(eq(jobAccounting.jobId, jobId), isNull(jobAccounting.cappedAt)))
    .returning({jobId: jobAccounting.jobId});

  return Boolean(row);
}

export async function isJobCapped(tx: Transaction, jobId: string): Promise<boolean> {
  const [row] = await tx
    .select({cappedAt: jobAccounting.cappedAt})
    .from(jobAccounting)
    .where(eq(jobAccounting.jobId, jobId));

  return Boolean(row?.cappedAt);
}

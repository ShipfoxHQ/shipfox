import {and, eq, isNull, lt, sql} from 'drizzle-orm';
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

/**
 * Prunes a job's accounting row, but only once it has had no budget activity for the full
 * retention horizon. `job_accounting` is live cap state: a still-active job re-touches
 * `updated_at` on every append, so the guard keeps retention from deleting a live budget row
 * (which would reset the job's cap on its next append). Callers gate this on the job also
 * having zero remaining streams.
 */
export async function deleteJobAccounting(
  tx: Transaction,
  params: {jobId: string; retentionDays: number},
): Promise<{deleted: boolean}> {
  const [row] = await tx
    .delete(jobAccounting)
    .where(
      and(
        eq(jobAccounting.jobId, params.jobId),
        lt(jobAccounting.updatedAt, sql`now() - make_interval(days => ${params.retentionDays})`),
      ),
    )
    .returning({jobId: jobAccounting.jobId});

  return {deleted: Boolean(row)};
}

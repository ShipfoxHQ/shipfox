import {and, eq, sql} from 'drizzle-orm';
import type {Transaction} from './db.js';
import {type AttemptStream, attemptStreams, toAttemptStream} from './schema/attempt-streams.js';

export interface AttemptStreamIdentity {
  jobId: string;
  stepId: string;
  attempt: number;
  workspaceId: string;
}

export interface AttemptStreamLookup {
  jobId: string;
  stepId: string;
  attempt: number;
}

/**
 * Reads the stream for `(job, step, attempt)` without creating it. Used by the
 * empty-body heartbeat path so a runner cannot mint rows with empty appends.
 */
export async function getAttemptStream(
  tx: Transaction,
  lookup: AttemptStreamLookup,
): Promise<AttemptStream | null> {
  const [row] = await tx
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.jobId, lookup.jobId),
        eq(attemptStreams.stepId, lookup.stepId),
        eq(attemptStreams.attempt, lookup.attempt),
      ),
    );
  return row ? toAttemptStream(row) : null;
}

/**
 * Loads the stream for `(job, step, attempt)`, creating it on first append.
 * Scoped by `jobId` from the lease, so a lease never reaches another job's stream.
 * A single upsert with `RETURNING` (the touch-update yields the row on conflict)
 * avoids a separate read on the hot path.
 */
export async function getOrCreateAttemptStream(
  tx: Transaction,
  identity: AttemptStreamIdentity,
): Promise<AttemptStream> {
  const [row] = await tx
    .insert(attemptStreams)
    .values(identity)
    .onConflictDoUpdate({
      target: [attemptStreams.jobId, attemptStreams.stepId, attemptStreams.attempt],
      set: {updatedAt: sql`now()`},
    })
    .returning();

  if (!row) throw new Error('attempt stream missing after upsert');
  return toAttemptStream(row);
}

export type CasOutcome = 'extended' | 'retry' | 'gap';

export interface CasResult {
  outcome: CasOutcome;
  committedLength: number;
}

/**
 * Offset-CAS extend: advances `committed_length` by `byteLen` iff it currently
 * equals `offset`. On mismatch, re-reads the committed length and classifies the
 * caller's chunk: a retry (fully already applied) only when `offset + byteLen`
 * does not run past the committed length; otherwise a gap. A chunk that straddles
 * the committed point (offset behind it, but extending past it) is a gap too, so
 * the runner rewinds rather than getting a 200 that silently drops its tail.
 */
export async function casExtendCommittedLength(
  tx: Transaction,
  params: {streamId: string; offset: number; byteLen: number},
): Promise<CasResult> {
  const extended = await tx
    .update(attemptStreams)
    .set({
      committedLength: sql`${attemptStreams.committedLength} + ${params.byteLen}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(attemptStreams.id, params.streamId),
        eq(attemptStreams.committedLength, params.offset),
      ),
    )
    .returning({committedLength: attemptStreams.committedLength});

  if (extended[0]) return {outcome: 'extended', committedLength: extended[0].committedLength};

  const [current] = await tx
    .select({committedLength: attemptStreams.committedLength})
    .from(attemptStreams)
    .where(eq(attemptStreams.id, params.streamId));
  const committedLength = current?.committedLength ?? 0;

  const fullyApplied = params.offset + params.byteLen <= committedLength;
  return {outcome: fullyApplied ? 'retry' : 'gap', committedLength};
}

export async function setDeclaredTotalBytes(
  tx: Transaction,
  params: {streamId: string; declaredTotalBytes: number},
): Promise<void> {
  await tx
    .update(attemptStreams)
    .set({declaredTotalBytes: params.declaredTotalBytes, updatedAt: sql`now()`})
    .where(eq(attemptStreams.id, params.streamId));
}

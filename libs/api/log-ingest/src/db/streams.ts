import {and, eq, sql} from 'drizzle-orm';
import type {Transaction} from './db.js';
import {type AttemptStream, attemptStreams, toAttemptStream} from './schema/attempt-streams.js';

export interface AttemptStreamIdentity {
  jobId: string;
  stepId: string;
  attempt: number;
  workspaceId: string;
}

/**
 * Loads the stream for `(job, step, attempt)`, creating it on first append.
 * Scoped by `jobId` from the lease, so a lease never reaches another job's stream.
 */
export async function getOrCreateAttemptStream(
  tx: Transaction,
  identity: AttemptStreamIdentity,
): Promise<AttemptStream> {
  await tx
    .insert(attemptStreams)
    .values(identity)
    .onConflictDoNothing({
      target: [attemptStreams.jobId, attemptStreams.stepId, attemptStreams.attempt],
    });

  const [row] = await tx
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.jobId, identity.jobId),
        eq(attemptStreams.stepId, identity.stepId),
        eq(attemptStreams.attempt, identity.attempt),
      ),
    );

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
 * caller's offset as a retry (already applied) or a gap (runner is ahead).
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

  return {outcome: params.offset > committedLength ? 'gap' : 'retry', committedLength};
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

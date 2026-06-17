import {and, asc, eq} from 'drizzle-orm';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import type {JobAccounting} from '#core/entities/job-accounting.js';
import {db} from '#db/db.js';
import {attemptStreams, toAttemptStream} from '#db/schema/attempt-streams.js';
import {type LogChunkDb, logChunks} from '#db/schema/chunks.js';
import {jobAccounting, toJobAccounting} from '#db/schema/job-accounting.js';

export interface StreamIdentity {
  jobId: string;
  stepId: string;
  attempt: number;
}

export async function findStream(identity: StreamIdentity): Promise<AttemptStream | null> {
  const [row] = await db()
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.jobId, identity.jobId),
        eq(attemptStreams.stepId, identity.stepId),
        eq(attemptStreams.attempt, identity.attempt),
      ),
    );
  return row ? toAttemptStream(row) : null;
}

export async function findAccounting(jobId: string): Promise<JobAccounting | null> {
  const [row] = await db().select().from(jobAccounting).where(eq(jobAccounting.jobId, jobId));
  return row ? toJobAccounting(row) : null;
}

export async function listChunks(streamId: string): Promise<LogChunkDb[]> {
  return await db()
    .select()
    .from(logChunks)
    .where(eq(logChunks.streamId, streamId))
    .orderBy(asc(logChunks.seq));
}

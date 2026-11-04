import {assertScopeWritable, recordDeletedScope} from '@shipfox/node-drizzle';
import {and, eq, inArray, isNull, sql} from 'drizzle-orm';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {db, type Transaction} from './db.js';
import {attemptStreams, toAttemptStream} from './schema/attempt-streams.js';
import {logsDeletedScopes} from './schema/deleted-scopes.js';
import {jobAccounting} from './schema/job-accounting.js';

export interface DeletedProjectScope {
  workspaceId: string;
  projectId: string;
}

/** Refuses a write to a root row of a deleted project. Call it first in the write's transaction. */
export function assertProjectWritable(tx: Transaction, scope: DeletedProjectScope): Promise<void> {
  return assertScopeWritable(tx, logsDeletedScopes, scope);
}

export async function recordProjectDeleted(
  scope: DeletedProjectScope,
  reason: string,
): Promise<void> {
  await db().transaction((tx) => recordDeletedScope(tx, logsDeletedScopes, {scope, reason}));
}

export async function markProjectPurged(scope: DeletedProjectScope): Promise<void> {
  await db()
    .update(logsDeletedScopes)
    .set({purgedAt: sql`now()`})
    .where(
      and(
        eq(logsDeletedScopes.workspaceId, scope.workspaceId),
        eq(logsDeletedScopes.projectId, scope.projectId),
        isNull(logsDeletedScopes.purgedAt),
      ),
    );
}

export async function listProjectStreams(
  scope: DeletedProjectScope,
  limit: number,
): Promise<AttemptStream[]> {
  const rows = await db()
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.workspaceId, scope.workspaceId),
        eq(attemptStreams.projectId, scope.projectId),
      ),
    )
    .limit(limit);
  return rows.map(toAttemptStream);
}

/**
 * Deletes the streams, which cascades to their chunks, and the accounting of the jobs that have
 * no stream left. The caller deletes the stored objects first. Each delete is guarded on the
 * observed `object_key`, so a stream that compaction published meanwhile stays for the next pass,
 * which sweeps its new objects before deleting it.
 */
export async function deleteStreamsWithAccounting(
  streams: readonly AttemptStream[],
): Promise<void> {
  if (streams.length === 0) return;
  const jobIds = [...new Set(streams.map((stream) => stream.jobId))];
  await db().transaction(async (tx) => {
    for (const stream of streams) {
      await tx
        .delete(attemptStreams)
        .where(
          and(
            eq(attemptStreams.id, stream.id),
            stream.objectKey === null
              ? isNull(attemptStreams.objectKey)
              : eq(attemptStreams.objectKey, stream.objectKey),
          ),
        );
    }
    await tx
      .delete(jobAccounting)
      .where(
        and(
          inArray(jobAccounting.jobId, jobIds),
          sql`not exists (select 1 from ${attemptStreams} where ${attemptStreams.jobId} = ${jobAccounting.jobId})`,
        ),
      );
  });
}

export async function projectHasStreams(scope: DeletedProjectScope): Promise<boolean> {
  const [row] = await db()
    .select({id: attemptStreams.id})
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.workspaceId, scope.workspaceId),
        eq(attemptStreams.projectId, scope.projectId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

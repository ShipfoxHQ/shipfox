import {MockActivityEnvironment} from '@temporalio/testing';
import {eq, sql} from 'drizzle-orm';
import {appendLogs} from '#core/append-logs.js';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findStream} from '#test/queries.js';
import {reapStaleOpenStreamsActivity} from './reap-stale-open-streams.js';

interface Ctx {
  jobId: string;
  stepId: string;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
}

function newCtx(): Ctx {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
  };
}

describe('reapStaleOpenStreamsActivity', () => {
  it('reaps a stale open stream end to end (config wiring under a real activity context)', async () => {
    const ctx = newCtx();
    await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody(outputLine('partial\n'))});
    const open = await findStream({...ctx, attempt: 1});
    // Past the default LOG_STREAM_REAP_AFTER_SECONDS (7200) the activity reads from config.
    await db()
      .update(attemptStreams)
      .set({createdAt: sql`now() - interval '3 hours'`})
      .where(eq(attemptStreams.id, open?.id as string));

    const result = (await new MockActivityEnvironment().run(
      reapStaleOpenStreamsActivity,
    )) as Awaited<ReturnType<typeof reapStaleOpenStreamsActivity>>;

    expect(result.reaped).toBeGreaterThanOrEqual(1);
    const after = await findStream({...ctx, attempt: 1});
    expect(after?.state).toBe('closed');
    expect(after?.closeReason).toBe('timeout');
  });
});

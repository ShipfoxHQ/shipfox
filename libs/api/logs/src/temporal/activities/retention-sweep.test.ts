import {MockActivityEnvironment} from '@temporalio/testing';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import {arrangeClosedStream, type ClosedStreamIdentity} from '#test/fixtures/closed-stream.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findStream} from '#test/queries.js';
import {retentionSweepActivity} from './retention-sweep.js';

function newIdentity(): ClosedStreamIdentity {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
  };
}

describe('retentionSweepActivity', () => {
  it('sweeps an expired stream end to end (config wiring + heartbeat under a real activity context)', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id, {chunks: [ndjsonBody(outputLine('x'))]});
    // Past the default LOG_RETENTION_DAYS (90) the activity reads from config.
    await db()
      .update(attemptStreams)
      .set({closedAt: sql`now() - interval '100 days'`})
      .where(eq(attemptStreams.id, stream.id));

    const result = (await new MockActivityEnvironment().run(retentionSweepActivity)) as Awaited<
      ReturnType<typeof retentionSweepActivity>
    >;

    expect(await findStream(id)).toBeNull();
    expect(result.timedOut).toBe(false);
  });
});

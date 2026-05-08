import {RUNNER_JOB_COMPLETED} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimJob} from '#db/jobs.js';
import {runnersOutbox} from '#db/schema/outbox.js';
import {runningJobs} from '#db/schema/running-jobs.js';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {detectAndFailStuckJobsActivity} from './maintenance-activities.js';

describe('detectAndFailStuckJobsActivity', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('delegates to detectAndFailStuckJobs and returns the failed count', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});
    await db()
      .update(runningJobs)
      .set({lastHeartbeatAt: sql`now() - interval '10 minutes'`})
      .where(eq(runningJobs.jobId, claimed?.jobId as string));

    const result = await detectAndFailStuckJobsActivity({thresholdSeconds: 180});

    expect(result.failed).toBeGreaterThanOrEqual(1);

    const stillRunning = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(stillRunning).toHaveLength(0);

    const outbox = await db()
      .select()
      .from(runnersOutbox)
      .where(eq(runnersOutbox.eventType, RUNNER_JOB_COMPLETED));
    const matching = outbox.filter(
      (row) => (row.payload as Record<string, unknown>).jobId === claimed?.jobId,
    );
    expect(matching).toHaveLength(1);
    expect((matching[0]?.payload as Record<string, unknown>).output).toEqual({
      reason: 'runner_disappeared',
    });
  });
});

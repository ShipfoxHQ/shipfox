import {RUNNER_JOB_LEASE_EXPIRED} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimPendingJob} from '#db/jobs.js';
import {runnersOutbox} from '#db/schema/outbox.js';
import {runningJobs} from '#db/schema/running-jobs.js';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {detectAndExpireStuckJobsActivity} from './maintenance-activities.js';

describe('detectAndExpireStuckJobsActivity', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('delegates to detectAndExpireStuckJobs and returns the expired count', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({workspaceId, runnerTokenId});
    await db()
      .update(runningJobs)
      .set({lastHeartbeatAt: sql`now() - interval '10 minutes'`})
      .where(eq(runningJobs.jobId, claimed?.jobId as string));

    const result = await detectAndExpireStuckJobsActivity({thresholdSeconds: 180});

    expect(result.expired).toBeGreaterThanOrEqual(1);

    const stillRunning = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, claimed?.jobId as string));
    expect(stillRunning).toHaveLength(0);

    const outbox = await db()
      .select()
      .from(runnersOutbox)
      .where(eq(runnersOutbox.eventType, RUNNER_JOB_LEASE_EXPIRED));
    const matching = outbox.filter(
      (row) => (row.payload as Record<string, unknown>).jobId === claimed?.jobId,
    );
    expect(matching).toHaveLength(1);
    const payload = matching[0]?.payload as Record<string, unknown>;
    expect(payload.runId).toBe(claimed?.runId);
    expect(payload.steps).toBeUndefined();
    expect(payload.status).toBeUndefined();
  });
});

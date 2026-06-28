import {RUNNER_JOB_LEASE_EXPIRED} from '@shipfox/api-runners-dto';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimPendingJob} from '#db/jobs.js';
import {runnersOutbox} from '#db/schema/outbox.js';
import {reservations} from '#db/schema/reservations.js';
import {runningJobs} from '#db/schema/running-jobs.js';
import {pendingJobFactory, reservationFactory, runnerSessionFactory} from '#test/index.js';
import {
  deleteExpiredReservationsActivity,
  detectAndExpireStuckJobsActivity,
} from './maintenance-activities.js';

describe('detectAndExpireStuckJobsActivity', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('delegates to detectAndExpireStuckJobs and returns the expired count', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJob({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
    });
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

describe('deleteExpiredReservationsActivity', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(async () => {
    await db().execute(sql`TRUNCATE runners_reservations CASCADE`);
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('deletes expired reservations and keeps active reservations', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux', 'gpu'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await deleteExpiredReservationsActivity();

    const remaining = await db().select().from(reservations);
    expect(result.deleted).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.requiredLabels).toEqual(['linux', 'gpu']);
  });
});

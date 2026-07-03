import {pgClient} from '@shipfox/node-postgres';
import {and, desc, eq, inArray, or, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {createRunnerSessionConsumingEphemeralToken} from '#db/ephemeral-registration-tokens.js';
import {
  listActiveProvisionedRunners,
  listProvisionerTerminateIntents,
  reapStaleProvisionedRunners,
  reconcileProvisionedRunners,
  reportProvisionedRunners,
} from '#db/provisioned-runners.js';
import {provisionedRunners} from '#db/schema/provisioned-runners.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {
  ephemeralRegistrationTokenFactory,
  provisionedRunnerFactory,
  provisionerTokenFactory,
  reservationFactory,
  runnerSessionFactory,
} from '#test/index.js';

function provisionedRunnerRowsFor(params: {workspaceId: string; provisionerId: string}) {
  return db()
    .select()
    .from(provisionedRunners)
    .where(
      and(
        eq(provisionedRunners.workspaceId, params.workspaceId),
        eq(provisionedRunners.provisionerId, params.provisionerId),
      ),
    );
}

function reservationRowsFor(params: {workspaceId: string; provisionerId: string}) {
  return db()
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.workspaceId, params.workspaceId),
        eq(reservations.provisionerId, params.provisionerId),
      ),
    );
}

describe('reportProvisionedRunners', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('dedupes duplicate provisioned runner ids in one batch', async () => {
    const reportedAt = new Date();

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', state: 'starting', reportedAt}),
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(reportedAt.getTime() + 1),
        }),
      ],
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('running');
  });

  it('uses state progression to dedupe equal-timestamp provisioned runner reports', async () => {
    const reportedAt = new Date();

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', state: 'running', reportedAt}),
        event({provisionedRunnerId: 'provisioned-runner-1', state: 'failed', reportedAt}),
        event({provisionedRunnerId: 'provisioned-runner-2', state: 'failed', reportedAt}),
        event({provisionedRunnerId: 'provisioned-runner-2', state: 'running', reportedAt}),
      ],
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId}).orderBy(
      provisionedRunners.provisionedRunnerId,
    );
    expect(result).toEqual({accepted: 2, reservationsReleased: 0});
    expect(rows.map((row) => row.state)).toEqual(['failed', 'failed']);
  });

  it('accepts delayed events that move the lifecycle forward', async () => {
    const newest = new Date();
    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', state: 'running', reportedAt: newest}),
      ],
    });

    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'failed',
          reason: 'late stale failure',
          reportedAt: new Date(newest.getTime() - 1_000),
        }),
      ],
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('failed');
    expect(rows[0]?.reason).toBe('late stale failure');
  });

  it('rejects older out-of-order events in the same lifecycle state', async () => {
    const newest = new Date();
    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reason: 'fresh',
          reportedAt: newest,
        }),
      ],
    });

    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reason: 'stale',
          reportedAt: new Date(newest.getTime() - 1_000),
        }),
      ],
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.reason).toBe('fresh');
  });

  it('does not let equal-timestamp lower-priority reports flip terminal state', async () => {
    const reservationId = await createReservation(1);
    const reportedAt = new Date('2025-01-01T00:00:00.000Z');
    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          reportedAt,
        }),
      ],
    });

    const terminal = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt,
        }),
      ],
    });
    const revived = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          reportedAt,
        }),
      ],
    });

    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(terminal).toEqual({accepted: 1, reservationsReleased: 1});
    expect(revived).toEqual({accepted: 1, reservationsReleased: 0});
    expect(provisionedRunnerRows[0]?.state).toBe('failed');
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows).toHaveLength(0);
  });

  it('clamps future reported times so they do not pin provisioned runner state', async () => {
    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'starting',
          reportedAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      ],
    });

    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(),
        }),
      ],
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.reportedAt.getTime()).toBeLessThan(Date.now() + 10_000);
  });

  it('records lifecycle milestone timestamps from one report batch', async () => {
    const startedAt = new Date('2025-01-01T00:00:00.000Z');
    const stoppingAt = new Date('2025-01-01T00:01:00.000Z');
    const stoppedAt = new Date('2025-01-01T00:02:00.000Z');
    const terminatedAt = new Date('2025-01-01T00:03:00.000Z');

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: startedAt,
        }),
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'stopping',
          reportedAt: stoppingAt,
        }),
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'stopped',
          reportedAt: stoppedAt,
        }),
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'terminated',
          reportedAt: terminatedAt,
        }),
      ],
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(rows[0]?.state).toBe('terminated');
    expect(rows[0]?.reportedAt.toISOString()).toBe(terminatedAt.toISOString());
    expect(rows[0]?.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(rows[0]?.stoppingAt?.toISOString()).toBe(stoppingAt.toISOString());
    expect(rows[0]?.stoppedAt?.toISOString()).toBe(stoppedAt.toISOString());
    expect(rows[0]?.failedAt).toBeNull();
    expect(rows[0]?.terminatedAt?.toISOString()).toBe(terminatedAt.toISOString());
  });

  it('records delayed lower-state milestones without reviving current state', async () => {
    const terminatedAt = new Date('2025-01-01T00:03:00.000Z');
    const startedAt = new Date('2025-01-01T00:00:00.000Z');
    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'terminated',
          reportedAt: terminatedAt,
        }),
      ],
    });

    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: startedAt,
        }),
      ],
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('terminated');
    expect(rows[0]?.reportedAt.toISOString()).toBe(terminatedAt.toISOString());
    expect(rows[0]?.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(rows[0]?.terminatedAt?.toISOString()).toBe(terminatedAt.toISOString());
  });

  it('uses server update time for active provisioned runner windows', async () => {
    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      ],
    });
    await db().execute(
      sql`UPDATE runners_provisioned_runners SET updated_at = now() - interval '10 minutes'`,
    );

    const active = await listActiveProvisionedRunners({workspaceId, windowSeconds: 60});

    expect(active).toEqual([]);
  });

  it('releases one reservation unit for a terminal unclaimed provisioned runner', async () => {
    const reservationId = await createReservation(2);

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'}),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1});
    expect(reservationRows[0]?.count).toBe(1);
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('does not release a reservation owned by another workspace or provisioner', async () => {
    const otherWorkspaceReservationId = await createReservation(1, {
      workspaceId: crypto.randomUUID(),
      provisionerId,
    });
    const peerProvisionerReservationId = await createReservation(1, {
      workspaceId,
      provisionerId: crypto.randomUUID(),
    });

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId: otherWorkspaceReservationId,
          state: 'failed',
        }),
        event({
          provisionedRunnerId: 'provisioned-runner-2',
          reservationId: peerProvisionerReservationId,
          state: 'failed',
        }),
      ],
    });

    const reservationRows = await db()
      .select()
      .from(reservations)
      .where(inArray(reservations.id, [otherWorkspaceReservationId, peerProvisionerReservationId]));
    expect(result).toEqual({accepted: 2, reservationsReleased: 0});
    expect(reservationRows).toHaveLength(2);
    expect(reservationRows.every((reservation) => reservation.count === 1)).toBe(true);
  });

  it('releases a reservation only once across repeated terminal reports', async () => {
    const reservationId = await createReservation(2);

    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'}),
      ],
    });
    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'}),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('does not let a newer running report revive a terminal provisioned runner', async () => {
    const reservationId = await createReservation(2);
    const failedAt = new Date();
    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: failedAt,
        }),
      ],
    });

    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          reportedAt: new Date(failedAt.getTime() + 1_000),
        }),
      ],
    });

    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(provisionedRunnerRows[0]?.state).toBe('failed');
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('tracks provider cleanup as terminated', async () => {
    const reservationId = await createReservation(2);

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', reservationId, state: 'terminated'}),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1});
    expect(reservationRows[0]?.count).toBe(1);
    expect(provisionedRunnerRows[0]?.state).toBe('terminated');
    expect(provisionedRunnerRows[0]?.terminatedAt).toBeInstanceOf(Date);
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('releases multiple units from the same reservation in one batch', async () => {
    const reservationId = await createReservation(3);

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'}),
        event({provisionedRunnerId: 'provisioned-runner-2', reservationId, state: 'stopped'}),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 2, reservationsReleased: 2});
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('deletes a one-unit reservation instead of violating the positive count check', async () => {
    const reservationId = await createReservation(1);

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({provisionedRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'}),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1});
    expect(reservationRows).toHaveLength(0);
  });

  it('flags release without retrying when the reservation is already expired', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    if (!reservation) throw new Error('Expected reservation');

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId: reservation.id,
          state: 'failed',
        }),
      ],
    });

    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('does not release a reservation for a provisioned runner that already has a runner session', async () => {
    const reservationId = await createReservation(1);

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          runnerSessionId: crypto.randomUUID(),
        }),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(reservationRows[0]?.count).toBe(1);
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeNull();
  });

  it('uses the consumed ephemeral token session before releasing a terminal report', async () => {
    const reservationId = await createReservation(1);
    const token = await ephemeralRegistrationTokenFactory.create({
      workspaceId,
      provisionerId,
      reservationId,
      provisionedRunnerId: 'provisioned-runner-1',
    });
    const session = await createRunnerSessionConsumingEphemeralToken({
      ephemeralTokenId: token.id,
      workspaceId,
      labels: ['linux'],
      maxClaims: 1,
    });

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          runnerSessionId: crypto.randomUUID(),
        }),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(reservationRows[0]?.count).toBe(1);
    expect(provisionedRunnerRows[0]?.runnerSessionId).toBe(session.id);
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeNull();
  });

  it('preserves claimed runner session metadata when a terminal state wins the batch', async () => {
    const reservationId = await createReservation(1);
    const runnerSessionId = crypto.randomUUID();
    const reportedAt = new Date('2025-01-01T00:00:00.000Z');

    const result = await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          runnerSessionId,
          reportedAt,
        }),
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: new Date(reportedAt.getTime() + 1_000),
        }),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(reservationRows[0]?.count).toBe(1);
    expect(provisionedRunnerRows[0]?.state).toBe('failed');
    expect(provisionedRunnerRows[0]?.runnerSessionId).toBe(runnerSessionId);
    expect(provisionedRunnerRows[0]?.reservationReleasedAt).toBeNull();
  });

  async function createReservation(
    count: number,
    overrides?: {workspaceId?: string; provisionerId?: string},
  ): Promise<string> {
    await reservationFactory.create({
      workspaceId: overrides?.workspaceId ?? workspaceId,
      provisionerId: overrides?.provisionerId ?? provisionerId,
      requiredLabels: ['linux'],
      count,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, overrides?.workspaceId ?? workspaceId),
          eq(reservations.provisionerId, overrides?.provisionerId ?? provisionerId),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    return reservation.id;
  }

  function event(params: {
    provisionedRunnerId?: string;
    reservationId?: string | null;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    reportedAt?: Date;
    reason?: string | null;
    runnerSessionId?: string | null;
  }) {
    return {
      provisionedRunnerId: params.provisionedRunnerId ?? 'provisioned-runner-1',
      reservationId: params.reservationId ?? null,
      templateKey: 'linux',
      labels: ['linux'],
      state: params.state ?? 'running',
      reason: params.reason ?? null,
      runnerSessionId: params.runnerSessionId ?? null,
      providerKind: 'docker',
      reportedAt: params.reportedAt ?? new Date(),
    };
  }
});

describe('listProvisionerTerminateIntents', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('includes active provisioned runners whose latest bound job is cancelled', async () => {
    await createProvisionedRunner({provisionedRunnerId: 'provisioned-runner-1'});
    await insertRunningJob({
      provisionedRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual(['provisioned-runner-1']);
  });

  it('excludes active provisioned runners whose latest bound job is healthy', async () => {
    await createProvisionedRunner({provisionedRunnerId: 'provisioned-runner-1'});
    await insertRunningJob({provisionedRunnerId: 'provisioned-runner-1'});

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('excludes terminal provisioned runners with cancelled bound jobs', async () => {
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      state: 'terminated',
    });
    await insertRunningJob({
      provisionedRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('excludes a cancelled job when it is not the latest bound job', async () => {
    await createProvisionedRunner({provisionedRunnerId: 'provisioned-runner-1'});
    await insertRunningJob({
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    await insertRunningJob({
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:02:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('excludes cancelled jobs for another provisioner', async () => {
    const otherProvisionerId = crypto.randomUUID();
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      provisionerId: otherProvisionerId,
    });
    await insertRunningJob({
      provisionedRunnerId: 'provisioned-runner-1',
      provisionerId: otherProvisionerId,
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('returns one id for duplicate cancelled bound jobs on the same provisioned runner', async () => {
    await createProvisionedRunner({provisionedRunnerId: 'provisioned-runner-1'});
    await insertRunningJob({
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    await insertRunningJob({
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual(['provisioned-runner-1']);
  });

  it('returns a deterministic subset when the limit truncates results', async () => {
    for (const provisionedRunnerId of [
      'provisioned-runner-c',
      'provisioned-runner-a',
      'provisioned-runner-b',
    ]) {
      await createProvisionedRunner({provisionedRunnerId});
      await insertRunningJob({
        provisionedRunnerId,
        cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
      });
    }

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 2});

    expect(result).toEqual(['provisioned-runner-a', 'provisioned-runner-b']);
  });

  async function createProvisionedRunner(params: {
    provisionedRunnerId: string;
    provisionerId?: string;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
  }) {
    return await provisionedRunnerFactory.create({
      workspaceId,
      provisionerId: params.provisionerId ?? provisionerId,
      provisionedRunnerId: params.provisionedRunnerId,
      state: params.state ?? 'running',
    });
  }

  async function insertRunningJob(params: {
    provisionedRunnerId: string;
    provisionerId?: string;
    jobExecutionId?: string;
    startedAt?: Date;
    cancellationRequestedAt?: Date | null;
  }) {
    const startedAt = params.startedAt ?? new Date('2025-01-01T00:00:00.000Z');

    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: params.jobExecutionId ?? crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId: crypto.randomUUID(),
        provisionerId: params.provisionerId ?? provisionerId,
        provisionedRunnerId: params.provisionedRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt,
        lastHeartbeatAt: startedAt,
        cancellationRequestedAt: params.cancellationRequestedAt ?? null,
      });
  }
});

describe('reapStaleProvisionedRunners', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const provisioner = await provisionerTokenFactory.create({workspaceId});
    provisionerId = provisioner.id;
  });

  it('fails stale unclaimed provisioned runners and releases reservations', async () => {
    const reservationId = await createReservation(2);
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });

    const result = await reapStaleProvisionedRunners({thresholdSeconds: 60, limit: 100});

    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({reaped: 1, reservationsReleased: 1});
    expect(provisionedRunner).toMatchObject({
      state: 'failed',
      reason: 'stale-provisioner',
    });
    expect(provisionedRunner?.failedAt).toBeInstanceOf(Date);
    expect(provisionedRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservation?.id).toBe(reservationId);
    expect(reservation?.count).toBe(1);
  });

  it('skips fresh rows, live provisioners, terminal rows, running jobs, and fresh sessions', async () => {
    await createProvisionedRunner({
      provisionedRunnerId: 'fresh-row',
      reportedAt: new Date(),
      updatedAt: new Date(),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'live-provisioner',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'terminal-row',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
      state: 'failed',
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'running-job',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    await insertRunningJob({provisionedRunnerId: 'running-job'});
    const freshSession = await createProvisionedRunner({
      provisionedRunnerId: 'fresh-session',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    await createLinkedSession({
      provisionedRunnerId: freshSession.provisionedRunnerId,
      updatedAt: new Date(),
    });
    await db()
      .update(provisionerTokens)
      .set({lastSeenAt: new Date()})
      .where(eq(provisionerTokens.id, provisionerId));

    const result = await reapStaleProvisionedRunners({thresholdSeconds: 60, limit: 100});

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId}).orderBy(
      provisionedRunners.provisionedRunnerId,
    );
    expect(result).toEqual({reaped: 0, reservationsReleased: 0});
    expect(rows.map((row) => [row.provisionedRunnerId, row.state])).toEqual([
      ['fresh-row', 'running'],
      ['fresh-session', 'running'],
      ['live-provisioner', 'running'],
      ['running-job', 'running'],
      ['terminal-row', 'failed'],
    ]);
  });

  it('releases reservations for stale rows whose linked session is no longer live', async () => {
    const reservationId = await createReservation(1);
    await createProvisionedRunner({
      provisionedRunnerId: 'stale-session',
      reservationId,
      runnerSessionId: '00000000-0000-4000-8000-000000000001',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    const session = await createLinkedSession({
      provisionedRunnerId: 'stale-session',
      updatedAt: staleAt(),
    });
    await db()
      .update(provisionedRunners)
      .set({runnerSessionId: session.id})
      .where(eq(provisionedRunners.provisionedRunnerId, 'stale-session'));

    const result = await reapStaleProvisionedRunners({thresholdSeconds: 60, limit: 100});

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({reaped: 1, reservationsReleased: 1});
    expect(provisionedRunner?.state).toBe('failed');
    expect(provisionedRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows.find((row) => row.id === reservationId)).toBeUndefined();
  });

  it('flags expired releases and drains only the configured batch size', async () => {
    const activeReservationId = await createReservation(2);
    const expiredReservationId = await createReservation(1, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'stale-1',
      reservationId: activeReservationId,
      reportedAt: staleAt(240_000),
      updatedAt: staleAt(240_000),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'stale-2',
      reservationId: expiredReservationId,
      reportedAt: staleAt(180_000),
      updatedAt: staleAt(180_000),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'stale-3',
      reportedAt: staleAt(120_000),
      updatedAt: staleAt(120_000),
    });

    const first = await reapStaleProvisionedRunners({thresholdSeconds: 60, limit: 2});
    const second = await reapStaleProvisionedRunners({thresholdSeconds: 60, limit: 2});

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(first).toEqual({reaped: 2, reservationsReleased: 1});
    expect(second).toEqual({reaped: 1, reservationsReleased: 0});
    expect(reservationRows.find((row) => row.id === activeReservationId)?.count).toBe(1);
    expect(reservationRows.find((row) => row.id === expiredReservationId)?.count).toBe(1);
    expect(provisionedRunnerRows.every((row) => row.state === 'failed')).toBe(true);
    expect(
      provisionedRunnerRows
        .filter((row) => row.reservationId)
        .every((row) => row.reservationReleasedAt instanceof Date),
    ).toBe(true);
  });

  it('does not double-release reservations when terminal report and reaper queue on the workspace lock', async () => {
    const reservationId = await createReservation(2);
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    const releaseWorkspaceLock = deferred<void>();
    const lockHolderReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      lockHolderReady.resolve();
      await releaseWorkspaceLock.promise;
    });

    await lockHolderReady.promise;
    const report = reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: new Date(),
        }),
      ],
    });
    await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    const reaper = reapStaleProvisionedRunners({thresholdSeconds: 60, limit: 100});
    try {
      await waitForLockWait({minWaiters: 2, queryLike: '%pg_advisory_xact_lock%'});
    } finally {
      releaseWorkspaceLock.resolve();
    }
    const [reportResult, reaperResult] = await Promise.all([report, reaper, lockHolder]);

    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(reportResult.reservationsReleased + reaperResult.reservationsReleased).toBe(1);
    expect(provisionedRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservation?.count).toBe(1);
  });

  async function createReservation(count: number, overrides?: {expiresAt?: Date}): Promise<string> {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count,
      expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    return reservation.id;
  }

  async function createProvisionedRunner(params: {
    provisionedRunnerId: string;
    reservationId?: string | null;
    runnerSessionId?: string | null;
    reportedAt: Date;
    updatedAt: Date;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
  }) {
    const row = await provisionedRunnerFactory.create({
      workspaceId,
      provisionerId,
      provisionedRunnerId: params.provisionedRunnerId,
      reservationId: params.reservationId ?? null,
      runnerSessionId: params.runnerSessionId ?? null,
      reportedAt: params.reportedAt,
      state: params.state ?? 'running',
    });
    await db()
      .update(provisionedRunners)
      .set({updatedAt: params.updatedAt})
      .where(eq(provisionedRunners.id, row.id));
    return {...row, updatedAt: params.updatedAt};
  }

  async function createLinkedSession(params: {provisionedRunnerId: string; updatedAt: Date}) {
    const session = await runnerSessionFactory.create({workspaceId});
    await db()
      .update(runnerSessions)
      .set({
        registrationTokenKind: 'ephemeral',
        provisionerId,
        provisionedRunnerId: params.provisionedRunnerId,
        maxClaims: 1,
        updatedAt: params.updatedAt,
      })
      .where(eq(runnerSessions.id, session.id));
    return session;
  }

  async function insertRunningJob(params: {provisionedRunnerId: string}) {
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId: crypto.randomUUID(),
        provisionerId,
        provisionedRunnerId: params.provisionedRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
        lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
      });
  }

  function staleAt(ageMs = 120_000): Date {
    return new Date(Date.now() - ageMs);
  }

  function event(params: {
    provisionedRunnerId: string;
    reservationId?: string | null;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    reportedAt?: Date;
  }) {
    return {
      provisionedRunnerId: params.provisionedRunnerId,
      reservationId: params.reservationId ?? null,
      templateKey: 'linux',
      labels: ['linux'],
      state: params.state ?? 'running',
      reason: null,
      runnerSessionId: null,
      providerKind: 'docker',
      reportedAt: params.reportedAt ?? new Date(),
    };
  }
});

describe('reconcileProvisionedRunners', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('terminates stale absent provisioned runners and releases reservations', async () => {
    const reservationId = await createReservation(2);
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });

    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result.absentIds).toEqual(['provisioned-runner-1']);
    expect(result.reservationsReleased).toBe(1);
    expect(provisionedRunner?.state).toBe('terminated');
    expect(provisionedRunner?.terminatedAt).toBeInstanceOf(Date);
    expect(reservation?.count).toBe(1);
  });

  it('keeps fresh absent provisioned runners inside the grace window', async () => {
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reportedAt: new Date(),
    });

    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result.absentIds).toEqual([]);
    expect(result.reservationsReleased).toBe(0);
    expect(provisionedRunner?.state).toBe('running');
  });

  it('respects a fresh report that commits after reconcile selects a stale absent row', async () => {
    const reservationId = await createReservation(1);
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });
    const releaseReportTransaction = deferred<void>();
    const reportTransactionUpdated = deferred<void>();

    const reportTransaction = db().transaction(async (tx) => {
      await tx
        .update(provisionedRunners)
        .set({reportedAt: sql`now()`, updatedAt: sql`now()`})
        .where(
          and(
            eq(provisionedRunners.workspaceId, workspaceId),
            eq(provisionedRunners.provisionerId, provisionerId),
            eq(provisionedRunners.provisionedRunnerId, 'provisioned-runner-1'),
          ),
        );
      reportTransactionUpdated.resolve();
      await releaseReportTransaction.promise;
    });

    await reportTransactionUpdated.promise;
    const reconcile = reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });
    try {
      await waitForLockWait({queryLike: '%provisioned_runners%'});
    } finally {
      releaseReportTransaction.resolve();
    }
    const [result] = await Promise.all([reconcile, reportTransaction]);

    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result.absentIds).toEqual([]);
    expect(result.reservationsReleased).toBe(0);
    expect(provisionedRunner?.state).toBe('running');
    expect(provisionedRunner?.reservationReleasedAt).toBeNull();
    expect(reservation?.count).toBe(1);
  });

  it('terminates only stale rows when the observed set is empty', async () => {
    await createProvisionedRunner({
      provisionedRunnerId: 'stale-runner',
      reportedAt: staleReportedAt(),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'fresh-runner',
      reportedAt: new Date(),
    });

    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    const rows = await provisionedRunnerRowsFor({workspaceId, provisionerId}).orderBy(
      provisionedRunners.provisionedRunnerId,
    );
    expect(result.absentIds).toEqual(['stale-runner']);
    expect(rows.map((row) => [row.provisionedRunnerId, row.state])).toEqual([
      ['fresh-runner', 'running'],
      ['stale-runner', 'terminated'],
    ]);
  });

  it('releases reservation units, deletes one-unit reservations, and flags expired releases', async () => {
    const sharedReservationId = await createReservation(3);
    const oneUnitReservationId = await createReservation(1);
    const expiredReservationId = await createReservation(1, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'shared-1',
      reservationId: sharedReservationId,
      reportedAt: staleReportedAt(),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'shared-2',
      reservationId: sharedReservationId,
      reportedAt: staleReportedAt(),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'one-unit',
      reservationId: oneUnitReservationId,
      reportedAt: staleReportedAt(),
    });
    await createProvisionedRunner({
      provisionedRunnerId: 'expired',
      reservationId: expiredReservationId,
      reportedAt: staleReportedAt(),
    });

    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const provisionedRunnerRows = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(result.reservationsReleased).toBe(3);
    expect(reservationRows).toHaveLength(2);
    expect(reservationRows.find((row) => row.id === sharedReservationId)?.count).toBe(1);
    expect(reservationRows.find((row) => row.id === expiredReservationId)?.count).toBe(1);
    expect(reservationRows.find((row) => row.id === oneUnitReservationId)).toBeUndefined();
    expect(provisionedRunnerRows.every((row) => row.reservationReleasedAt instanceof Date)).toBe(
      true,
    );
  });

  it('is idempotent across repeated reconciles', async () => {
    const reservationId = await createReservation(2);
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });

    const first = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });
    const second = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(first.reservationsReleased).toBe(1);
    expect(second.reservationsReleased).toBe(0);
    expect(reservation?.count).toBe(1);
  });

  it('does not touch provisioned runners from another workspace or provisioner', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    const otherProvisionerId = crypto.randomUUID();
    await createProvisionedRunner({
      provisionedRunnerId: 'owned-runner',
      reportedAt: staleReportedAt(),
    });
    await provisionedRunnerFactory.create({
      workspaceId: otherWorkspaceId,
      provisionerId,
      provisionedRunnerId: 'other-workspace-runner',
      reportedAt: staleReportedAt(),
      state: 'running',
    });
    await provisionedRunnerFactory.create({
      workspaceId,
      provisionerId: otherProvisionerId,
      provisionedRunnerId: 'other-provisioner-runner',
      reportedAt: staleReportedAt(),
      state: 'running',
    });

    await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    const rows = await db()
      .select()
      .from(provisionedRunners)
      .where(
        or(
          and(
            eq(provisionedRunners.workspaceId, workspaceId),
            eq(provisionedRunners.provisionerId, provisionerId),
          ),
          and(
            eq(provisionedRunners.workspaceId, otherWorkspaceId),
            eq(provisionedRunners.provisionerId, provisionerId),
          ),
          and(
            eq(provisionedRunners.workspaceId, workspaceId),
            eq(provisionedRunners.provisionerId, otherProvisionerId),
          ),
        ),
      )
      .orderBy(provisionedRunners.provisionedRunnerId);
    expect(rows.map((row) => [row.provisionedRunnerId, row.state])).toEqual([
      ['other-provisioner-runner', 'running'],
      ['other-workspace-runner', 'running'],
      ['owned-runner', 'terminated'],
    ]);
  });

  it('terminates session-bound absent runners without releasing their reservation', async () => {
    const reservationId = await createReservation(1);
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId,
      runnerSessionId: crypto.randomUUID(),
      reportedAt: staleReportedAt(),
    });

    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result.reservationsReleased).toBe(0);
    expect(provisionedRunner?.state).toBe('terminated');
    expect(provisionedRunner?.reservationReleasedAt).toBeNull();
    expect(reservation?.count).toBe(1);
  });

  it('returns a deterministic newest running job execution bound to an observed provisioned runner', async () => {
    await createProvisionedRunner({provisionedRunnerId: 'provisioned-runner-1'});
    const lowerJobId = '00000000-0000-4000-8000-000000000001';
    const higherJobId = '00000000-0000-4000-8000-000000000002';
    const lowerJobExecutionId = '10000000-0000-4000-8000-000000000001';
    const higherJobExecutionId = '10000000-0000-4000-8000-000000000002';
    await insertRunningJob({
      jobId: lowerJobId,
      jobExecutionId: lowerJobExecutionId,
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await insertRunningJob({
      jobId: higherJobId,
      jobExecutionId: higherJobExecutionId,
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: ['provisioned-runner-1'],
      terminateGraceSeconds: 60,
    });

    expect(
      result.boundJobExecutionsByProvisionedRunnerId.get('provisioned-runner-1')?.jobExecutionId,
    ).toBe(higherJobExecutionId);
  });

  it('does not let a later running report revive a reconcile-terminated runner', async () => {
    const reportedAt = staleReportedAt();
    await createProvisionedRunner({provisionedRunnerId: 'provisioned-runner-1', reportedAt});
    await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });

    await reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(reportedAt.getTime() + 120_000),
        }),
      ],
    });

    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    expect(provisionedRunner?.state).toBe('terminated');
  });

  it('does not double-release reservations when terminal report and reconcile queue on the workspace lock', async () => {
    const reservationId = await createReservation(2);
    await createProvisionedRunner({
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });
    const releaseWorkspaceLock = deferred<void>();
    const lockHolderReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      lockHolderReady.resolve();
      await releaseWorkspaceLock.promise;
    });

    await lockHolderReady.promise;
    const report = reportProvisionedRunners({
      workspaceId,
      provisionerId,
      events: [
        event({
          provisionedRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: new Date(),
        }),
      ],
    });
    await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    const reconcile = reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: [],
      terminateGraceSeconds: 60,
    });
    try {
      await waitForLockWait({minWaiters: 2, queryLike: '%pg_advisory_xact_lock%'});
    } finally {
      releaseWorkspaceLock.resolve();
    }
    const [reportResult, reconcileResult] = await Promise.all([report, reconcile, lockHolder]);

    const [provisionedRunner] = await provisionedRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(reportResult.reservationsReleased + reconcileResult.reservationsReleased).toBe(1);
    expect(provisionedRunner?.state).toSatisfy(
      (state: string | undefined) => state === 'failed' || state === 'terminated',
    );
    expect(provisionedRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservation?.count).toBe(1);
  });

  async function createReservation(count: number, overrides?: {expiresAt?: Date}): Promise<string> {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count,
      expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    return reservation.id;
  }

  async function createProvisionedRunner(params: {
    provisionedRunnerId: string;
    reservationId?: string | null;
    runnerSessionId?: string | null;
    reportedAt?: Date;
  }) {
    return await provisionedRunnerFactory.create({
      workspaceId,
      provisionerId,
      provisionedRunnerId: params.provisionedRunnerId,
      reservationId: params.reservationId ?? null,
      runnerSessionId: params.runnerSessionId ?? null,
      reportedAt: params.reportedAt ?? new Date(),
      state: 'running',
    });
  }

  async function insertRunningJob(params: {
    jobId: string;
    jobExecutionId?: string;
    provisionedRunnerId: string;
    startedAt: Date;
  }) {
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        jobId: params.jobId,
        jobExecutionId: params.jobExecutionId ?? crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId: crypto.randomUUID(),
        provisionerId,
        provisionedRunnerId: params.provisionedRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: params.startedAt,
        lastHeartbeatAt: params.startedAt,
      });
  }

  function staleReportedAt(): Date {
    return new Date(Date.now() - 120_000);
  }

  function event(params: {
    provisionedRunnerId: string;
    reservationId?: string | null;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    reportedAt?: Date;
  }) {
    return {
      provisionedRunnerId: params.provisionedRunnerId,
      reservationId: params.reservationId ?? null,
      templateKey: 'linux',
      labels: ['linux'],
      state: params.state ?? 'running',
      reason: null,
      runnerSessionId: null,
      providerKind: 'docker',
      reportedAt: params.reportedAt ?? new Date(),
    };
  }
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {promise, resolve, reject};
}

async function waitForLockWait(params?: {minWaiters?: number; queryLike?: string}) {
  const minWaiters = params?.minWaiters ?? 1;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await pgClient().query<{count: number}>(
      `
        SELECT count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND ($1::text IS NULL OR query ILIKE $1)
      `,
      [params?.queryLike ?? null],
    );
    if ((result.rows[0]?.count ?? 0) >= minWaiters) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${minWaiters} blocked lock waiter(s)`);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

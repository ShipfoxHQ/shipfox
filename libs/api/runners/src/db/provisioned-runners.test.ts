import {and, desc, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  listActiveProvisionedRunners,
  reconcileProvisionedRunners,
  reportProvisionedRunners,
} from '#db/provisioned-runners.js';
import {provisionedRunners} from '#db/schema/provisioned-runners.js';
import {reservations} from '#db/schema/reservations.js';
import {runningJobs} from '#db/schema/running-jobs.js';
import {provisionedRunnerFactory, reservationFactory} from '#test/index.js';

describe('reportProvisionedRunners', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(async () => {
    await db().execute(sql`TRUNCATE runners_provisioned_runners, runners_reservations CASCADE`);
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

    const rows = await db().select().from(provisionedRunners);
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

    const rows = await db()
      .select()
      .from(provisionedRunners)
      .orderBy(provisionedRunners.provisionedRunnerId);
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

    const rows = await db().select().from(provisionedRunners);
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

    const rows = await db().select().from(provisionedRunners);
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

    const provisionedRunnerRows = await db().select().from(provisionedRunners);
    const reservationRows = await db().select().from(reservations);
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

    const rows = await db().select().from(provisionedRunners);
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

    const rows = await db().select().from(provisionedRunners);
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

    const rows = await db().select().from(provisionedRunners);
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

    const reservationRows = await db().select().from(reservations);
    const provisionedRunnerRows = await db().select().from(provisionedRunners);
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

    const reservationRows = await db().select().from(reservations);
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

    const reservationRows = await db().select().from(reservations);
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

    const provisionedRunnerRows = await db().select().from(provisionedRunners);
    const reservationRows = await db().select().from(reservations);
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

    const reservationRows = await db().select().from(reservations);
    const provisionedRunnerRows = await db().select().from(provisionedRunners);
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

    const reservationRows = await db().select().from(reservations);
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

    const reservationRows = await db().select().from(reservations);
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
    const [reservation] = await db().select().from(reservations);
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

    const provisionedRunnerRows = await db().select().from(provisionedRunners);
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

    const reservationRows = await db().select().from(reservations);
    const provisionedRunnerRows = await db().select().from(provisionedRunners);
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(reservationRows[0]?.count).toBe(1);
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

    const reservationRows = await db().select().from(reservations);
    const provisionedRunnerRows = await db().select().from(provisionedRunners);
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

describe('reconcileProvisionedRunners', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_provisioned_runners, runners_reservations, runners_running_jobs CASCADE`,
    );
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

    const [provisionedRunner] = await db().select().from(provisionedRunners);
    const [reservation] = await db().select().from(reservations);
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

    const [provisionedRunner] = await db().select().from(provisionedRunners);
    expect(result.absentIds).toEqual([]);
    expect(result.reservationsReleased).toBe(0);
    expect(provisionedRunner?.state).toBe('running');
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

    const rows = await db()
      .select()
      .from(provisionedRunners)
      .orderBy(provisionedRunners.provisionedRunnerId);
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

    const reservationRows = await db().select().from(reservations);
    const provisionedRunnerRows = await db().select().from(provisionedRunners);
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

    const [reservation] = await db().select().from(reservations);
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

    const [provisionedRunner] = await db().select().from(provisionedRunners);
    const [reservation] = await db().select().from(reservations);
    expect(result.reservationsReleased).toBe(0);
    expect(provisionedRunner?.state).toBe('terminated');
    expect(provisionedRunner?.reservationReleasedAt).toBeNull();
    expect(reservation?.count).toBe(1);
  });

  it('returns the newest running job bound to an observed provisioned runner', async () => {
    await createProvisionedRunner({provisionedRunnerId: 'provisioned-runner-1'});
    const olderJobId = crypto.randomUUID();
    const newerJobId = crypto.randomUUID();
    await insertRunningJob({
      jobId: olderJobId,
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await insertRunningJob({
      jobId: newerJobId,
      provisionedRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId,
      observedProvisionedRunnerIds: ['provisioned-runner-1'],
      terminateGraceSeconds: 60,
    });

    expect(result.boundJobsByProvisionedRunnerId.get('provisioned-runner-1')?.jobId).toBe(
      newerJobId,
    );
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

    const [provisionedRunner] = await db().select().from(provisionedRunners);
    expect(provisionedRunner?.state).toBe('terminated');
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
    provisionedRunnerId: string;
    startedAt: Date;
  }) {
    await db()
      .insert(runningJobs)
      .values({
        workspaceId,
        jobId: params.jobId,
        runId: crypto.randomUUID(),
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
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    reportedAt?: Date;
  }) {
    return {
      provisionedRunnerId: params.provisionedRunnerId,
      reservationId: null,
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

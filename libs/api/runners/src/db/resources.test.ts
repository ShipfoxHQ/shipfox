import {and, desc, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {listActiveResources, reportResources} from '#db/resources.js';
import {reservations} from '#db/schema/reservations.js';
import {resources} from '#db/schema/resources.js';
import {reservationFactory} from '#test/index.js';

describe('reportResources', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(async () => {
    await db().execute(sql`TRUNCATE runners_resources, runners_reservations CASCADE`);
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('dedupes duplicate resource ids in one batch', async () => {
    const reportedAt = new Date();

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({resourceId: 'resource-1', state: 'starting', reportedAt}),
        event({
          resourceId: 'resource-1',
          state: 'running',
          reportedAt: new Date(reportedAt.getTime() + 1),
        }),
      ],
    });

    const rows = await db().select().from(resources);
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('running');
  });

  it('uses state progression to dedupe equal-timestamp resource reports', async () => {
    const reportedAt = new Date();

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({resourceId: 'resource-1', state: 'running', reportedAt}),
        event({resourceId: 'resource-1', state: 'failed', reportedAt}),
        event({resourceId: 'resource-2', state: 'failed', reportedAt}),
        event({resourceId: 'resource-2', state: 'running', reportedAt}),
      ],
    });

    const rows = await db().select().from(resources).orderBy(resources.resourceId);
    expect(result).toEqual({accepted: 2, reservationsReleased: 0});
    expect(rows.map((row) => row.state)).toEqual(['failed', 'failed']);
  });

  it('rejects older out-of-order events', async () => {
    const newest = new Date();
    await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', state: 'running', reportedAt: newest})],
    });

    await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({
          resourceId: 'resource-1',
          state: 'failed',
          reason: 'late stale failure',
          reportedAt: new Date(newest.getTime() - 1_000),
        }),
      ],
    });

    const rows = await db().select().from(resources);
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.reason).toBeNull();
  });

  it('does not let equal-timestamp lower-priority reports flip terminal state', async () => {
    const reservationId = await createReservation(1);
    const reportedAt = new Date();
    await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId, state: 'running', reportedAt})],
    });

    const terminal = await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId, state: 'failed', reportedAt})],
    });
    const revived = await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId, state: 'running', reportedAt})],
    });

    const resourceRows = await db().select().from(resources);
    const reservationRows = await db().select().from(reservations);
    expect(terminal).toEqual({accepted: 1, reservationsReleased: 1});
    expect(revived).toEqual({accepted: 1, reservationsReleased: 0});
    expect(resourceRows[0]?.state).toBe('failed');
    expect(resourceRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows).toHaveLength(0);
  });

  it('clamps future reported times so they do not pin resource state', async () => {
    await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({
          resourceId: 'resource-1',
          state: 'starting',
          reportedAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      ],
    });

    await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', state: 'running', reportedAt: new Date()})],
    });

    const rows = await db().select().from(resources);
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.reportedAt.getTime()).toBeLessThan(Date.now() + 10_000);
  });

  it('uses server update time for active-resource windows', async () => {
    await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({
          resourceId: 'resource-1',
          state: 'running',
          reportedAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      ],
    });
    await db().execute(
      sql`UPDATE runners_resources SET updated_at = now() - interval '10 minutes'`,
    );

    const active = await listActiveResources({workspaceId, windowSeconds: 60});

    expect(active).toEqual([]);
  });

  it('releases one reservation unit for a terminal unclaimed resource', async () => {
    const reservationId = await createReservation(2);

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId, state: 'failed'})],
    });

    const reservationRows = await db().select().from(reservations);
    const resourceRows = await db().select().from(resources);
    expect(result).toEqual({accepted: 1, reservationsReleased: 1});
    expect(reservationRows[0]?.count).toBe(1);
    expect(resourceRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
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

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({
          resourceId: 'resource-1',
          reservationId: otherWorkspaceReservationId,
          state: 'failed',
        }),
        event({
          resourceId: 'resource-2',
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

    await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId, state: 'failed'})],
    });
    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId, state: 'failed'})],
    });

    const reservationRows = await db().select().from(reservations);
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('keeps reservation released when a newer running report revives the resource', async () => {
    const reservationId = await createReservation(2);
    const failedAt = new Date();
    await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({resourceId: 'resource-1', reservationId, state: 'failed', reportedAt: failedAt}),
      ],
    });

    await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({
          resourceId: 'resource-1',
          reservationId,
          state: 'running',
          reportedAt: new Date(failedAt.getTime() + 1_000),
        }),
      ],
    });

    const resourceRows = await db().select().from(resources);
    const reservationRows = await db().select().from(reservations);
    expect(resourceRows[0]?.state).toBe('running');
    expect(resourceRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('releases multiple units from the same reservation in one batch', async () => {
    const reservationId = await createReservation(3);

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({resourceId: 'resource-1', reservationId, state: 'failed'}),
        event({resourceId: 'resource-2', reservationId, state: 'stopped'}),
      ],
    });

    const reservationRows = await db().select().from(reservations);
    expect(result).toEqual({accepted: 2, reservationsReleased: 2});
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('deletes a one-unit reservation instead of violating the positive count check', async () => {
    const reservationId = await createReservation(1);

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId, state: 'failed'})],
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

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [event({resourceId: 'resource-1', reservationId: reservation.id, state: 'failed'})],
    });

    const resourceRows = await db().select().from(resources);
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(resourceRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('does not release a reservation for a resource that already has a runner session', async () => {
    const reservationId = await createReservation(1);

    const result = await reportResources({
      workspaceId,
      provisionerId,
      events: [
        event({
          resourceId: 'resource-1',
          reservationId,
          state: 'failed',
          runnerSessionId: crypto.randomUUID(),
        }),
      ],
    });

    const reservationRows = await db().select().from(reservations);
    const resourceRows = await db().select().from(resources);
    expect(result).toEqual({accepted: 1, reservationsReleased: 0});
    expect(reservationRows[0]?.count).toBe(1);
    expect(resourceRows[0]?.reservationReleasedAt).toBeNull();
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
    resourceId?: string;
    reservationId?: string | null;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
    reportedAt?: Date;
    reason?: string | null;
    runnerSessionId?: string | null;
  }) {
    return {
      resourceId: params.resourceId ?? 'resource-1',
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

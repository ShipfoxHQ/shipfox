import {sql, sum} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  deleteReservationsByIds,
  pollDemandAndReserve,
  releaseReservationUnits,
} from '#db/reservations.js';
import {reservations} from '#db/schema/reservations.js';
import {pendingJobFactory, reservationFactory} from '#test/index.js';

describe('pollDemandAndReserve', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_reservations, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('caps grants by unreserved demand, available slots, and max reservations', async () => {
    await createPendingJobs(50, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 100,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 20)],
    });

    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]?.count).toBe(20);
    expect(result.stats[0]).toMatchObject({labels: ['linux'], queued: 50, reserved: 20});
  });

  it('allocates overlapping label sets most-specific-first', async () => {
    await createPendingJobs(2, ['linux']);
    await createPendingJobs(1, ['linux', 'gpu']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1), template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 1}),
      expect.objectContaining({labels: ['linux'], count: 1}),
    ]);
  });

  it('serializes multiple provisioners so total active reservations do not exceed queued demand', async () => {
    await createPendingJobs(5, ['linux']);

    await Promise.all([
      pollDemandAndReserve({
        workspaceId,
        provisionerId: crypto.randomUUID(),
        maxReservations: 5,
        ttlSeconds: 60,
        templates: [template('linux-a', ['linux'], 5)],
      }),
      pollDemandAndReserve({
        workspaceId,
        provisionerId: crypto.randomUUID(),
        maxReservations: 5,
        ttlSeconds: 60,
        templates: [template('linux-b', ['linux'], 5)],
      }),
    ]);

    const reserved = await activeReservedCount();
    expect(reserved).toBeLessThanOrEqual(5);
  });

  it('does not count expired reservations against demand', async () => {
    await createPendingJobs(1, ['linux']);
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]?.count).toBe(1);
    expect(result.stats[0]).toMatchObject({queued: 1, reserved: 1});
  });

  it('deducts this provisioner active reservations from advertised capacity', async () => {
    await createPendingJobs(10, ['linux']);
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 5,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 5,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 5)],
    });

    const reserved = await activeReservedCount();
    expect(result.reservations).toEqual([]);
    expect(result.stats[0]).toMatchObject({queued: 10, reserved: 5});
    expect(reserved).toBe(5);
  });

  it('returns multiple reservation groups in one response', async () => {
    await createPendingJobs(2, ['linux']);
    await createPendingJobs(1, ['macos']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 3,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 2), template('macos', ['macos'], 1)],
    });

    expect(result.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({labels: ['linux'], count: 2}),
        expect.objectContaining({labels: ['macos'], count: 1}),
      ]),
    );
  });

  it('splits max reservation budget across groups after the most-specific group', async () => {
    await createPendingJobs(3, ['linux', 'gpu']);
    await createPendingJobs(3, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 4,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 10), template('linux-gpu', ['linux', 'gpu'], 10)],
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 3}),
      expect.objectContaining({labels: ['linux'], count: 1}),
    ]);
  });

  it('excludes demand that no template can satisfy from stats', async () => {
    await createPendingJobs(1, ['windows']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(result).toEqual({stats: [], reservations: []});
  });

  it('returns stats without writing rows when max reservations is zero', async () => {
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 0,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const reserved = await activeReservedCount();
    expect(result.stats).toEqual([
      expect.objectContaining({labels: ['linux'], queued: 1, reserved: 0}),
    ]);
    expect(result.reservations).toEqual([]);
    expect(reserved).toBe(0);
  });

  it('sets reservation expiry from database time', async () => {
    await createPendingJobs(1, ['linux']);
    const before = Date.now();

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const expiresAt = result.reservations[0]?.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt?.getTime()).toBeGreaterThan(before + 50_000);
  });

  it('deletes reservations by id', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['macos'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const beforeDelete = await db().select().from(reservations);
    const deletedReservation = beforeDelete.find((reservation) =>
      reservation.requiredLabels.includes('linux'),
    );
    if (!deletedReservation) throw new Error('Expected linux reservation');

    const deleted = await deleteReservationsByIds([deletedReservation.id]);

    const remaining = await db().select().from(reservations);
    expect(deleted).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.requiredLabels).toEqual(['macos']);
  });

  it('decrements reservation units inside a caller transaction', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db().select().from(reservations);
    if (!reservation) throw new Error('Expected reservation');

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: [{reservationId: reservation.id, count: 2}],
      }),
    );

    const rows = await db().select().from(reservations);
    expect(released).toBe(2);
    expect(rows[0]?.count).toBe(1);
  });

  it('deletes reservations when releasing all remaining units', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db().select().from(reservations);
    if (!reservation) throw new Error('Expected reservation');

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: [{reservationId: reservation.id, count: 1}],
      }),
    );

    const rows = await db().select().from(reservations);
    expect(released).toBe(1);
    expect(rows).toHaveLength(0);
  });

  it('does not release another workspace or provisioner reservation', async () => {
    await reservationFactory.create({
      workspaceId: crypto.randomUUID(),
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await reservationFactory.create({
      workspaceId,
      provisionerId: crypto.randomUUID(),
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const rowsBefore = await db().select().from(reservations);

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: rowsBefore.map((reservation) => ({reservationId: reservation.id, count: 1})),
      }),
    );

    const rowsAfter = await db().select().from(reservations);
    expect(released).toBe(0);
    expect(rowsAfter.map((reservation) => reservation.id).sort()).toEqual(
      rowsBefore.map((reservation) => reservation.id).sort(),
    );
  });

  it('credits only the deleted reservation count when release units exceed the row count', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db().select().from(reservations);
    if (!reservation) throw new Error('Expected reservation');

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: [{reservationId: reservation.id, count: 3}],
      }),
    );

    const rows = await db().select().from(reservations);
    expect(released).toBe(1);
    expect(rows).toHaveLength(0);
  });

  async function createPendingJobs(count: number, requiredLabels: string[]): Promise<void> {
    for (let index = 0; index < count; index++) {
      await pendingJobFactory.create({workspaceId, requiredLabels});
    }
  }

  async function activeReservedCount(): Promise<number> {
    const [row] = await db()
      .select({value: sum(reservations.count)})
      .from(reservations)
      .where(
        sql`${reservations.workspaceId} = ${workspaceId} and ${reservations.expiresAt} > now()`,
      );
    return Number(row?.value ?? 0);
  }

  function template(templateKey: string, labels: string[], availableSlots: number) {
    return {templateKey, labels, availableSlots, starting: 0, running: 0};
  }
});

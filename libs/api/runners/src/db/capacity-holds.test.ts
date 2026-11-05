import {and, eq, isNull} from 'drizzle-orm';
import {
  assignRunnerCapacityHoldTx,
  bindCapacityHoldToRunnerTx,
  getWorkspaceCapacityUsage,
  insertLaunchCapacityHoldsTx,
  releaseCapacityHoldsForRunnerInstancesTx,
  releaseUnboundCapacityHoldsForReservationsTx,
  sweepOrphanedLaunchCapacityHolds,
  sweepTerminalCapacityHolds,
} from '#db/capacity-holds.js';
import {db} from '#db/db.js';
import {capacityHolds} from '#db/schema/capacity-holds.js';
import {reservations} from '#db/schema/reservations.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {providerRunnerFactory} from '#test/factories/runner-instance.js';

describe('capacity holds', () => {
  it('binds launch holds and keeps bound capacity when the reservation expires', async () => {
    const workspaceId = crypto.randomUUID();
    const reservationId = crypto.randomUUID();
    const runner = await providerRunnerFactory.create({workspaceId});

    await db().transaction(async (tx) => {
      await insertLaunchCapacityHoldsTx(tx, {
        workspaceId,
        reservationId,
        units: [2],
      });
      expect(
        await bindCapacityHoldToRunnerTx(tx, {reservationId, runnerInstanceId: runner.id}),
      ).toBe(true);
      expect(
        await releaseUnboundCapacityHoldsForReservationsTx(tx, {
          reservationIds: [reservationId],
          reason: 'reservation-expired',
        }),
      ).toBe(0);
    });

    const [hold] = await db()
      .select()
      .from(capacityHolds)
      .where(eq(capacityHolds.runnerInstanceId, runner.id));
    expect(hold).toMatchObject({workspaceId, reservationId, units: 2, releasedAt: null});
  });

  it('moves an adopted runner hold to the adopting workspace', async () => {
    const firstWorkspaceId = crypto.randomUUID();
    const adoptingWorkspaceId = crypto.randomUUID();
    const runner = await providerRunnerFactory.create({workspaceId: firstWorkspaceId});
    await db().insert(capacityHolds).values({
      workspaceId: firstWorkspaceId,
      runnerInstanceId: runner.id,
      jobExecutionId: crypto.randomUUID(),
      units: 1,
    });

    await db().transaction((tx) =>
      assignRunnerCapacityHoldTx(tx, {
        workspaceId: adoptingWorkspaceId,
        runnerInstanceId: runner.id,
        units: 2,
      }),
    );

    const holds = await db()
      .select()
      .from(capacityHolds)
      .where(and(eq(capacityHolds.runnerInstanceId, runner.id), isNull(capacityHolds.releasedAt)));
    expect(holds).toEqual([
      expect.objectContaining({workspaceId: adoptingWorkspaceId, units: 2, jobExecutionId: null}),
    ]);
  });

  it('releases an unbound hold when its reservation expires', async () => {
    const reservationId = crypto.randomUUID();
    await db().transaction((tx) =>
      insertLaunchCapacityHoldsTx(tx, {
        workspaceId: crypto.randomUUID(),
        reservationId,
        units: [1],
      }),
    );

    expect(
      await db().transaction((tx) =>
        releaseUnboundCapacityHoldsForReservationsTx(tx, {
          reservationIds: [reservationId],
          reason: 'reservation-expired',
        }),
      ),
    ).toBe(1);
    const [hold] = await db()
      .select()
      .from(capacityHolds)
      .where(eq(capacityHolds.reservationId, reservationId));
    expect(hold?.releaseReason).toBe('reservation-expired');
  });

  it('releases a bound hold only after the runner becomes terminal', async () => {
    const workspaceId = crypto.randomUUID();
    const runner = await providerRunnerFactory.create({workspaceId, state: 'running'});
    await db().insert(capacityHolds).values({
      workspaceId,
      runnerInstanceId: runner.id,
      units: 1,
    });

    expect(
      await db().transaction((tx) =>
        releaseCapacityHoldsForRunnerInstancesTx(tx, {runnerInstanceIds: [runner.id]}),
      ),
    ).toBe(0);
    await db()
      .update(providerRunners)
      .set({state: 'stopped'})
      .where(eq(providerRunners.id, runner.id));
    expect(
      await db().transaction((tx) =>
        releaseCapacityHoldsForRunnerInstancesTx(tx, {runnerInstanceIds: [runner.id]}),
      ),
    ).toBe(1);
  });

  it('sweeps terminal holds and reports workspace usage from unreleased holds', async () => {
    const workspaceId = crypto.randomUUID();
    const runner = await providerRunnerFactory.create({workspaceId, state: 'stopped'});
    await db().insert(capacityHolds).values({workspaceId, runnerInstanceId: runner.id, units: 3});
    await db().insert(capacityHolds).values({workspaceId, units: 2});

    const usage = await getWorkspaceCapacityUsage({workspaceIds: [workspaceId]});
    expect(usage).toEqual([{workspaceId, unitsInUse: 5, queuedForCapacity: 0}]);
    expect(await sweepTerminalCapacityHolds()).toBe(1);
    const afterSweep = await getWorkspaceCapacityUsage({workspaceIds: [workspaceId]});
    expect(afterSweep[0]?.unitsInUse).toBe(2);
  });

  it('binds each launch hold to one runner when several runners bind in one transaction', async () => {
    const workspaceId = crypto.randomUUID();
    const reservationId = crypto.randomUUID();
    const first = await providerRunnerFactory.create({workspaceId});
    const second = await providerRunnerFactory.create({workspaceId});
    const third = await providerRunnerFactory.create({workspaceId});

    const bound = await db().transaction(async (tx) => {
      await insertLaunchCapacityHoldsTx(tx, {workspaceId, reservationId, units: [1, 1]});
      const results: boolean[] = [];
      for (const runner of [first, second, third])
        results.push(
          await bindCapacityHoldToRunnerTx(tx, {reservationId, runnerInstanceId: runner.id}),
        );
      return results;
    });

    expect(bound).toEqual([true, true, false]);
    const holds = await db()
      .select()
      .from(capacityHolds)
      .where(eq(capacityHolds.reservationId, reservationId));
    expect(holds.map((hold) => hold.runnerInstanceId).sort()).toEqual([first.id, second.id].sort());
  });

  it('sweeps unbound launch holds whose reservation is gone', async () => {
    const workspaceId = crypto.randomUUID();
    const [liveReservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId: crypto.randomUUID(),
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!liveReservation) throw new Error('Expected reservation');
    const missingReservationId = crypto.randomUUID();
    const runner = await providerRunnerFactory.create({workspaceId});
    await db().transaction(async (tx) => {
      await insertLaunchCapacityHoldsTx(tx, {
        workspaceId,
        reservationId: liveReservation.id,
        units: [1],
      });
      await insertLaunchCapacityHoldsTx(tx, {
        workspaceId,
        reservationId: missingReservationId,
        units: [1, 2],
      });
      await bindCapacityHoldToRunnerTx(tx, {
        reservationId: missingReservationId,
        runnerInstanceId: runner.id,
      });
    });

    expect(await sweepOrphanedLaunchCapacityHolds()).toBeGreaterThanOrEqual(1);

    const holds = await db()
      .select()
      .from(capacityHolds)
      .where(eq(capacityHolds.workspaceId, workspaceId));
    expect(
      holds.map((hold) => ({
        reservationId: hold.reservationId,
        bound: hold.runnerInstanceId !== null,
        releaseReason: hold.releaseReason,
      })),
    ).toEqual(
      expect.arrayContaining([
        {reservationId: liveReservation.id, bound: false, releaseReason: null},
        {reservationId: missingReservationId, bound: true, releaseReason: null},
        {reservationId: missingReservationId, bound: false, releaseReason: 'reservation-missing'},
      ]),
    );
    expect(holds).toHaveLength(3);
  });
});

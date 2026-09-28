import {and, eq, isNull} from 'drizzle-orm';
import {
  assignRunnerCapacityHoldTx,
  bindCapacityHoldToRunnerTx,
  getWorkspaceCapacityUsage,
  insertLaunchCapacityHoldsTx,
  releaseCapacityHoldsForRunnerInstancesTx,
  releaseUnboundCapacityHoldsForReservationsTx,
  sweepTerminalCapacityHolds,
} from '#db/capacity-holds.js';
import {db} from '#db/db.js';
import {capacityHolds} from '#db/schema/capacity-holds.js';
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
      expect(await releaseUnboundCapacityHoldsForReservationsTx(tx, [reservationId])).toBe(0);
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
        releaseUnboundCapacityHoldsForReservationsTx(tx, [reservationId]),
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
});

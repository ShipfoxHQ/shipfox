import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {provisionedRunners} from '#db/schema/provisioned-runners.js';
import {reservations} from '#db/schema/reservations.js';
import {provisionedRunnerReapedCount, reservationReleasedCount} from '#metrics/instance.js';
import {
  provisionedRunnerFactory,
  provisionerTokenFactory,
  reservationFactory,
} from '#test/index.js';
import {deleteExpiredRunnerReservations, reapStaleProvisionedRunners} from './maintenance.js';

describe('deleteExpiredRunnerReservations', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
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

    const result = await deleteExpiredRunnerReservations();

    const remaining = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.workspaceId, workspaceId));
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.requiredLabels).toEqual(['linux', 'gpu']);
  });
});

describe('reapStaleProvisionedRunners', () => {
  it('returns reaped counts and records maintenance metrics', async () => {
    const workspaceId = crypto.randomUUID();
    const provisioner = await provisionerTokenFactory.create({workspaceId});
    await reservationFactory.create({
      workspaceId,
      provisionerId: provisioner.id,
      requiredLabels: ['linux'],
      count: 2,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.workspaceId, workspaceId));
    if (!reservation) throw new Error('Expected reservation');
    const provisionedRunner = await provisionedRunnerFactory.create({
      workspaceId,
      provisionerId: provisioner.id,
      provisionedRunnerId: 'provisioned-runner-1',
      reservationId: reservation.id,
      reportedAt: new Date(Date.now() - 120_000),
    });
    await db()
      .update(provisionedRunners)
      .set({updatedAt: new Date(Date.now() - 120_000)})
      .where(eq(provisionedRunners.id, provisionedRunner.id));
    const reapedSpy = vi.spyOn(provisionedRunnerReapedCount, 'add');
    const releasedSpy = vi.spyOn(reservationReleasedCount, 'add');

    const result = await reapStaleProvisionedRunners({thresholdSeconds: 60, limit: 100});

    expect(result).toEqual({reaped: 1, reservationsReleased: 1});
    expect(reapedSpy).toHaveBeenCalledWith(1);
    expect(releasedSpy).toHaveBeenCalledWith(1);
  });
});

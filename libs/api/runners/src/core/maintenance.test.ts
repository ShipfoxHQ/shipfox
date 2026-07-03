import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {reservations} from '#db/schema/reservations.js';
import {reservationFactory} from '#test/index.js';
import {deleteExpiredRunnerReservations} from './maintenance.js';

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

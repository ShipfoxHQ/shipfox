import {eq, inArray} from 'drizzle-orm';
import {assignCapacityBatch} from '#db/capacity-assignments.js';
import {db} from '#db/db.js';
import {capacityAssignments} from '#db/schema/capacity-assignments.js';
import {provisionedRunners} from '#db/schema/provisioned-runners.js';
import {reservations} from '#db/schema/reservations.js';

describe('assignCapacityBatch', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('assigns compatible live capacity once and returns the same assignment on retry', async () => {
    const reservation = await createReservation();
    const capacity = await createCapacity();

    const first = await assignCapacityBatch({
      provisionerId,
      reservationId: reservation.id,
      capacityIds: [capacity.id],
    });
    const retry = await assignCapacityBatch({
      provisionerId,
      reservationId: reservation.id,
      capacityIds: [capacity.id],
    });

    expect(first).toHaveLength(1);
    expect(retry).toEqual(first);
    expect(first[0]).toMatchObject({
      capacityId: capacity.id,
      reservationId: reservation.id,
      workspaceId,
      provisionerId,
    });
  });

  it('does not rebind capacity or a reservation under concurrent assignment requests', async () => {
    const reservation = await createReservation();
    const firstCapacity = await createCapacity();
    const secondCapacity = await createCapacity();

    const result = await Promise.allSettled([
      assignCapacityBatch({
        provisionerId,
        reservationId: reservation.id,
        capacityIds: [firstCapacity.id],
      }),
      assignCapacityBatch({
        provisionerId,
        reservationId: reservation.id,
        capacityIds: [secondCapacity.id],
      }),
    ]);

    expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rows = await db()
      .select()
      .from(capacityAssignments)
      .where(eq(capacityAssignments.reservationId, reservation.id));
    expect(rows).toHaveLength(1);
  });

  it('consumes each slot in a multi-capacity reservation without rebinding capacity', async () => {
    const reservation = await createReservation({count: 2});
    const firstCapacity = await createCapacity();
    const secondCapacity = await createCapacity();

    const assignments = await assignCapacityBatch({
      provisionerId,
      reservationId: reservation.id,
      capacityIds: [firstCapacity.id, secondCapacity.id],
    });
    const retry = await assignCapacityBatch({
      provisionerId,
      reservationId: reservation.id,
      capacityIds: [firstCapacity.id, secondCapacity.id],
    });

    expect(assignments).toHaveLength(2);
    expect(retry).toEqual(assignments);
  });

  it('rejects expired, incompatible, and foreign capacity without consuming it', async () => {
    const expiredReservation = await createReservation({expiresAt: new Date(Date.now() - 1_000)});
    const compatibleCapacity = await createCapacity();
    const incompatibleReservation = await createReservation({requiredLabels: ['gpu']});
    const foreignCapacity = await createCapacity({provisionerId: crypto.randomUUID()});

    await expect(
      assignCapacityBatch({
        provisionerId,
        reservationId: expiredReservation.id,
        capacityIds: [compatibleCapacity.id],
      }),
    ).rejects.toMatchObject({name: 'ReservationExpiredError'});
    await expect(
      assignCapacityBatch({
        provisionerId,
        reservationId: incompatibleReservation.id,
        capacityIds: [compatibleCapacity.id],
      }),
    ).rejects.toMatchObject({name: 'CapacityNotAssignableError'});
    await expect(
      assignCapacityBatch({
        provisionerId,
        reservationId: incompatibleReservation.id,
        capacityIds: [foreignCapacity.id],
      }),
    ).rejects.toMatchObject({name: 'CapacityNotAssignableError'});

    const rows = await db()
      .select()
      .from(capacityAssignments)
      .where(
        inArray(capacityAssignments.reservationId, [
          expiredReservation.id,
          incompatibleReservation.id,
        ]),
      );
    expect(rows).toEqual([]);
  });

  async function createReservation(overrides: Partial<typeof reservations.$inferInsert> = {}) {
    const [row] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('Reservation insert returned no row');
    return row;
  }

  async function createCapacity(overrides: Partial<typeof provisionedRunners.$inferInsert> = {}) {
    const [row] = await db()
      .insert(provisionedRunners)
      .values({
        provisionerId,
        provisionedRunnerId: crypto.randomUUID(),
        labels: ['linux'],
        state: 'running',
        reportedAt: new Date(),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('Capacity insert returned no row');
    return row;
  }
});

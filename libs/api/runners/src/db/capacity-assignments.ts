import {and, eq, inArray, sql} from 'drizzle-orm';
import type {CapacityAssignment} from '#core/entities/capacity-assignment.js';
import {
  CapacityAlreadyAssignedError,
  CapacityNotAssignableError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '#core/errors.js';
import {db} from './db.js';
import {capacityAssignments, toCapacityAssignment} from './schema/capacity-assignments.js';
import {reservations} from './schema/reservations.js';
import {providerRunners} from './schema/runner-instances.js';

export async function assignCapacityBatch(params: {
  provisionerId: string;
  reservationId: string;
  capacityIds: string[];
}): Promise<CapacityAssignment[]> {
  return await db().transaction(async (tx) => {
    const lockKey = [
      'runners_capacity_assignments',
      params.provisionerId,
      params.reservationId,
    ].join(':');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    for (const capacityId of [...params.capacityIds].sort()) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${['runners_capacity_assignments', capacityId].join(':')}))`,
      );
    }

    const [reservation] = await tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, params.reservationId),
          eq(reservations.provisionerId, params.provisionerId),
        ),
      )
      .limit(1);
    if (!reservation) throw new ReservationNotFoundError(params.reservationId);
    if (reservation.expiresAt <= new Date())
      throw new ReservationExpiredError(params.reservationId);

    const existing = await tx
      .select()
      .from(capacityAssignments)
      .where(eq(capacityAssignments.reservationId, reservation.id));
    const existingByCapacityId = new Map(
      existing.map((assignment) => [assignment.capacityId, assignment]),
    );
    const newCapacityIds = params.capacityIds.filter(
      (capacityId) => !existingByCapacityId.has(capacityId),
    );
    if (existing.length + newCapacityIds.length > reservation.count)
      throw new CapacityNotAssignableError(params.capacityIds[0] ?? '');

    if (newCapacityIds.length === 0) {
      return params.capacityIds.flatMap((capacityId) => {
        const assignment = existingByCapacityId.get(capacityId);
        return assignment ? [toCapacityAssignment(assignment)] : [];
      });
    }

    const capacities = await tx
      .select()
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.provisionerId, params.provisionerId),
          inArray(providerRunners.id, newCapacityIds),
        ),
      );
    if (capacities.length !== newCapacityIds.length)
      throw new CapacityNotAssignableError(params.capacityIds[0] ?? '');
    for (const capacity of capacities) {
      if (capacity.state !== 'starting' && capacity.state !== 'running')
        throw new CapacityNotAssignableError(capacity.id);
      if (
        !capacity.providerRunnerId ||
        capacity.labels.length === 0 ||
        !reservation.requiredLabels.every((label) => capacity.labels.includes(label))
      ) {
        throw new CapacityNotAssignableError(capacity.id);
      }
    }

    const assignedCapacity = await tx
      .select({capacityId: capacityAssignments.capacityId})
      .from(capacityAssignments)
      .where(inArray(capacityAssignments.capacityId, newCapacityIds));
    if (assignedCapacity.length > 0)
      throw new CapacityAlreadyAssignedError(assignedCapacity[0]?.capacityId ?? '');

    const inserted = await tx
      .insert(capacityAssignments)
      .values(
        newCapacityIds.map((capacityId) => ({
          capacityId,
          reservationId: reservation.id,
          workspaceId: reservation.workspaceId,
          provisionerId: params.provisionerId,
        })),
      )
      .returning();
    const insertedByCapacityId = new Map(
      inserted.map((assignment) => [assignment.capacityId, assignment]),
    );
    return params.capacityIds.flatMap((capacityId) => {
      const assignment =
        existingByCapacityId.get(capacityId) ?? insertedByCapacityId.get(capacityId);
      return assignment ? [toCapacityAssignment(assignment)] : [];
    });
  });
}

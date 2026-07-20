import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  assignCapacityBatchBodySchema,
  assignCapacityBatchResponseSchema,
} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {assignCapacityBatch} from '#core/capacity-assignments.js';
import {
  CapacityAlreadyAssignedError,
  CapacityNotAssignableError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '#core/errors.js';

export const assignCapacityRoute = defineRoute({
  method: 'POST',
  path: '/capacity/assignments',
  description: 'Atomically assign provisioner capacity to a live reservation',
  schema: {body: assignCapacityBatchBodySchema, response: {200: assignCapacityBatchResponseSchema}},
  errorHandler: (error) => {
    if (error instanceof ReservationNotFoundError)
      throw new ClientError('Reservation not found', 'reservation-not-found', {status: 404});
    if (error instanceof ReservationExpiredError)
      throw new ClientError('Reservation has expired', 'reservation-expired', {status: 409});
    if (
      error instanceof CapacityAlreadyAssignedError ||
      error instanceof CapacityNotAssignableError
    )
      throw new ClientError('Capacity cannot be assigned', 'capacity-not-assignable', {
        status: 409,
      });
    throw error;
  },
  handler: async (request) => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    const assignments = await assignCapacityBatch({
      provisionerId: provisionerTokenId,
      reservationId: request.body.reservation_id,
      capacityIds: request.body.capacity_ids,
    });
    return {
      assignments: assignments.map((assignment) => ({
        capacity_id: assignment.capacityId,
        assignment_id: assignment.id,
      })),
    };
  },
});

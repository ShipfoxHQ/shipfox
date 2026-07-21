import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  assignRunnerInstancesBodySchema,
  assignRunnerInstancesResponseSchema,
} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  ReservationExpiredError,
  ReservationNotFoundError,
  RunnerInstanceAlreadyAssignedError,
  RunnerInstanceNotAssignableError,
} from '#core/errors.js';
import {assignRunnerInstances} from '#core/runner-assignments.js';

export const assignRunnerInstancesRoute = defineRoute({
  method: 'POST',
  path: '/runner-instances/assignments',
  description: 'Assign enrolled runner instances to an owned demand reservation',
  schema: {
    body: assignRunnerInstancesBodySchema,
    response: {200: assignRunnerInstancesResponseSchema},
  },
  errorHandler: (error) => {
    if (error instanceof ReservationNotFoundError)
      throw new ClientError('Reservation not found', 'reservation-not-found', {status: 404});
    if (error instanceof ReservationExpiredError)
      throw new ClientError('Reservation has expired', 'reservation-expired', {status: 409});
    if (
      error instanceof RunnerInstanceAlreadyAssignedError ||
      error instanceof RunnerInstanceNotAssignableError
    )
      throw new ClientError(
        'Runner instance cannot be assigned',
        'runner-instance-not-assignable',
        {status: 409},
      );
    throw error;
  },
  handler: async (request) => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    return {
      runner_instance_ids: await assignRunnerInstances({
        provisionerId: provisionerTokenId,
        reservationId: request.body.reservation_id,
        runnerInstanceIds: request.body.runner_instance_ids,
      }),
    };
  },
});

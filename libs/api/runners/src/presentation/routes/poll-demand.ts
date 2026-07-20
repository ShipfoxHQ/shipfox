import {requireWorkspaceProvisionerContext} from '@shipfox/api-auth-context';
import {pollDemandBodySchema, pollDemandResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {pollDemand, releaseReservationGrants} from '#core/demand.js';
import type {ReservationGrant} from '#db/reservations.js';
import {toPollDemandResponseDto} from '#presentation/dto/index.js';

const TERMINATE_INTENT_LIMIT = 1000;

export const pollDemandRoute = defineRoute({
  method: 'POST',
  path: '/demand/poll',
  description: 'Poll aggregate runner demand and reserve capacity for a provisioner',
  schema: {
    body: pollDemandBodySchema,
    response: {
      200: pollDemandResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const {provisionerTokenId, workspaceId} = requireWorkspaceProvisionerContext(request);
    const abortController = new AbortController();
    let responseFinished = false;
    let responseReservations: ReservationGrant[] = [];
    reply.raw.on('finish', () => {
      responseFinished = true;
    });
    reply.raw.on('close', () => {
      if (!responseFinished) {
        abortController.abort();
        void releaseReservationGrants(responseReservations).catch(() => undefined);
      }
    });

    const result = await pollDemand({
      workspaceId,
      provisionerId: provisionerTokenId,
      maxReservations: request.body.max_reservations,
      waitSeconds: request.body.wait_seconds,
      ttlSeconds: config.RESERVATION_TTL_SECONDS,
      terminateIntentLimit: TERMINATE_INTENT_LIMIT,
      templates: request.body.templates.map((template) => ({
        templateKey: template.template_key,
        labels: template.labels,
        availableSlots: template.available_slots,
        starting: template.starting,
        running: template.running,
      })),
      signal: abortController.signal,
    });
    responseReservations = result.reservations;

    return toPollDemandResponseDto(result);
  },
});

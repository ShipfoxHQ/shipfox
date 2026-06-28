import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {pollDemandBodySchema, pollDemandResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {pollDemand} from '#core/demand.js';
import {toPollDemandResponseDto} from '#presentation/dto/index.js';

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
  handler: async (request) => {
    const {provisionerTokenId, workspaceId} = requireProvisionerContext(request);
    const abortController = new AbortController();
    request.raw.on('close', () => abortController.abort());

    const result = await pollDemand({
      workspaceId,
      provisionerId: provisionerTokenId,
      maxReservations: request.body.max_reservations,
      waitSeconds: request.body.wait_seconds,
      ttlSeconds: config.RESERVATION_TTL_SECONDS,
      templates: request.body.templates.map((template) => ({
        templateKey: template.template_key,
        labels: template.labels,
        availableSlots: template.available_slots,
        starting: template.starting,
        running: template.running,
      })),
      signal: abortController.signal,
    });

    return toPollDemandResponseDto(result);
  },
});

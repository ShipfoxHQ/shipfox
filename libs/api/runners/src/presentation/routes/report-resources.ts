import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {reportResourcesBodySchema, reportResourcesResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {reportResources} from '#core/index.js';
import {toReportResourcesResponseDto} from '#presentation/dto/index.js';

export const reportResourcesRoute = defineRoute({
  method: 'POST',
  path: '/resources/report',
  description: 'Report provisioned runner resource lifecycle state',
  schema: {
    body: reportResourcesBodySchema,
    response: {
      200: reportResourcesResponseSchema,
    },
  },
  handler: async (request) => {
    const {provisionerTokenId, workspaceId} = requireProvisionerContext(request);
    const result = await reportResources({
      workspaceId,
      provisionerId: provisionerTokenId,
      events: request.body.events.map((event) => ({
        resourceId: event.resource_id,
        reservationId: event.reservation_id ?? null,
        templateKey: event.template_key ?? null,
        labels: event.labels,
        state: event.state,
        reason: event.reason ?? null,
        runnerSessionId: event.runner_session_id ?? null,
        providerKind: event.provider_kind ?? null,
        reportedAt: new Date(event.reported_at),
      })),
    });

    return toReportResourcesResponseDto(result);
  },
});

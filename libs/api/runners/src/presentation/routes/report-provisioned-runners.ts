import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  reportProvisionedRunnersBodySchema,
  reportProvisionedRunnersResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {reportProvisionedRunners} from '#core/index.js';
import {toReportProvisionedRunnersResponseDto} from '#presentation/dto/index.js';

export const reportProvisionedRunnersRoute = defineRoute({
  method: 'POST',
  path: '/provisioned-runners/report',
  description: 'Report provisioned runner lifecycle state',
  schema: {
    body: reportProvisionedRunnersBodySchema,
    response: {
      200: reportProvisionedRunnersResponseSchema,
    },
  },
  handler: async (request) => {
    const context = requireProvisionerContext(request);
    const result = await reportProvisionedRunners({
      workspaceId: context.scope === 'workspace' ? context.workspaceId : null,
      provisionerId: context.provisionerTokenId,
      events: request.body.events.map((event) => ({
        provisionedRunnerId: event.provisioned_runner_id,
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

    return toReportProvisionedRunnersResponseDto(result);
  },
});

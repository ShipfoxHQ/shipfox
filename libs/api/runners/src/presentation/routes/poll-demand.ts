import {
  requireProvisionerContext,
  requireWorkspaceProvisionerContext,
} from '@shipfox/api-auth-context';
import {pollDemandBodySchema, pollDemandResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {pollDemand, releaseReservationGrants} from '#core/demand.js';
import {publishWorkspaceProvisionerCapabilitySnapshot} from '#db/provisioner-capability-snapshots.js';
import type {ReservationGrant} from '#db/reservations.js';
import type {CreateRunnersModuleOptions} from '#installation-provisioning.js';
import {toPollDemandResponseDto} from '#presentation/dto/index.js';

const TERMINATE_INTENT_LIMIT = 1000;

export function createPollDemandRoute(options: CreateRunnersModuleOptions = {}) {
  return defineRoute({
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
      const provisionerContext = requireProvisionerContext(request);
      // A host that configures installationProvisioning is opting in to installation-scoped
      // demand polling, but this route doesn't apply the eligibility policy yet: fail loudly
      // instead of silently ignoring it. Hosts that never opt in fall through to the
      // requireWorkspaceProvisionerContext 403 below, same as before this option existed.
      if (provisionerContext.scope === 'installation' && options.installationProvisioning) {
        throw new ClientError(
          'Installation demand allocation is unavailable',
          'installation-provisioning-unavailable',
          {status: 501},
        );
      }
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

      const templates = request.body.templates.map((template) => ({
        templateKey: template.template_key,
        labels: template.labels,
        availableSlots: template.available_slots,
        starting: template.starting,
        running: template.running,
      }));
      await publishWorkspaceProvisionerCapabilitySnapshot({
        workspaceId,
        provisionerId: provisionerTokenId,
        templates,
      });

      const result = await pollDemand({
        workspaceId,
        provisionerId: provisionerTokenId,
        maxReservations: request.body.max_reservations,
        waitSeconds: request.body.wait_seconds,
        ttlSeconds: config.RESERVATION_TTL_SECONDS,
        terminateIntentLimit: TERMINATE_INTENT_LIMIT,
        templates,
        signal: abortController.signal,
      });
      responseReservations = result.reservations;

      return toPollDemandResponseDto(result);
    },
  });
}

export const pollDemandRoute = createPollDemandRoute();

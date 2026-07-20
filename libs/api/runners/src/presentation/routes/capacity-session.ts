import {requireCapacitySessionContext} from '@shipfox/api-auth-context';
import {
  attachProviderRunnerBodySchema,
  attachProviderRunnerResponseSchema,
  capacityHeartbeatResponseSchema,
  capacitySessionResponseSchema,
  declareCapacityBodySchema,
  declareCapacityResponseSchema,
  exchangeCapacityBootstrapBodySchema,
} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute, extractBearerToken} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {
  attachProviderRunnerId,
  declareCapacity,
  exchangeCapacityBootstrapCredential,
} from '#core/index.js';

export const exchangeCapacityBootstrapRoute = defineRoute({
  method: 'POST',
  path: '/sessions',
  description: 'Exchange a single-use capacity bootstrap credential for a capacity-only session',
  schema: {
    body: exchangeCapacityBootstrapBodySchema,
    response: {200: capacitySessionResponseSchema},
  },
  handler: async (request) => {
    const rawToken = extractBearerToken(request.headers.authorization);
    if (!rawToken)
      throw new ClientError('Invalid capacity bootstrap credential', 'unauthorized', {status: 401});
    const result = await exchangeCapacityBootstrapCredential(
      rawToken,
      config.CAPACITY_SESSION_TTL_SECONDS,
    );
    if (!result) {
      throw new ClientError('Invalid capacity bootstrap credential', 'unauthorized', {status: 401});
    }
    return {
      session_token: result.sessionToken,
      session_id: result.sessionId,
      capacity_id: result.capacityId,
    };
  },
});

export const declareCapacityRoute = defineRoute({
  method: 'POST',
  path: '/declare',
  description: 'Declare routing labels for the authenticated unassigned capacity',
  schema: {body: declareCapacityBodySchema, response: {200: declareCapacityResponseSchema}},
  handler: async (request) => {
    const context = requireCapacitySessionContext(request);
    const accepted = await declareCapacity({
      capacityId: context.capacityId,
      provisionerId: context.provisionerId,
      labels: request.body.labels,
      providerKind: request.body.provider_kind ?? null,
    });
    return {accepted};
  },
});

export const attachCapacityProviderRunnerRoute = defineRoute({
  method: 'POST',
  path: '/provider-runner',
  description: 'Attach the authenticated capacity provider identity once',
  schema: {
    body: attachProviderRunnerBodySchema,
    response: {200: attachProviderRunnerResponseSchema},
  },
  handler: async (request) => {
    const context = requireCapacitySessionContext(request);
    const attached = await attachProviderRunnerId({
      capacityId: context.capacityId,
      provisionerId: context.provisionerId,
      provisionedRunnerId: request.body.provisioned_runner_id,
    });
    return {attached};
  },
});

const capacityHeartbeatHandler = async () => ({ok: true as const});

export const capacityHeartbeatRoute = defineRoute({
  method: 'POST',
  path: '/heartbeat',
  description: 'Record liveness for the authenticated capacity session',
  schema: {response: {200: capacityHeartbeatResponseSchema}},
  handler: capacityHeartbeatHandler,
});

export const reconcileCapacityRoute = defineRoute({
  method: 'POST',
  path: '/reconcile',
  description: 'Confirm that the authenticated capacity session remains usable',
  schema: {response: {200: capacityHeartbeatResponseSchema}},
  handler: capacityHeartbeatHandler,
});

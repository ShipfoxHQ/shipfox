import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {featureFlagsQuerySchema, featureFlagsResponseSchema} from '@shipfox/api-common-dto';
import type {FlagDefinition} from '@shipfox/feature-flags';
import {defineRoute} from '@shipfox/node-fastify';
import type {FeatureFlags} from '@shipfox/node-feature-flags';
import type {ShipfoxModule} from '@shipfox/node-module';

/**
 * Serves the flags the modules declare with `client: true`. The browser polls it, so a flip
 * reaches a focused tab without a reload.
 */
export function createFeatureFlagsModule(params: {
  featureFlags: FeatureFlags;
  modules: readonly ShipfoxModule[];
}): ShipfoxModule {
  const definitions = params.modules
    .flatMap((module) => Object.values(module.flags ?? {}))
    .filter((definition) => definition.client === true);
  return {
    name: 'feature-flags',
    routes: [createFeatureFlagsRoute({featureFlags: params.featureFlags, definitions})],
  };
}

export function createFeatureFlagsRoute(params: {
  featureFlags: FeatureFlags;
  definitions: readonly FlagDefinition[];
}) {
  const {featureFlags, definitions} = params;
  return defineRoute({
    method: 'GET',
    path: '/feature-flags',
    auth: AUTH_USER,
    description:
      'Evaluate the client-visible feature flags for the caller, and for a workspace when one is given.',
    schema: {
      querystring: featureFlagsQuerySchema,
      response: {
        200: featureFlagsResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {workspace_id: workspaceId} = request.query;
      const {userId, email} = requireUserContext(request);
      if (workspaceId !== undefined) requireWorkspaceAccess({request, workspaceId});
      const subject = {userId, email, workspaceId};
      const entries = await Promise.all(
        definitions.map(
          async (definition) =>
            [
              definition.key,
              definition.kind === 'boolean'
                ? await featureFlags.boolean(definition, subject)
                : await featureFlags.config(definition, subject),
            ] as const,
        ),
      );
      reply.header('cache-control', 'no-store');
      return {flags: Object.fromEntries(entries)};
    },
  });
}

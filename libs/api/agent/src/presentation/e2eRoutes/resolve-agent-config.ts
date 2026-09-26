import {
  harnessSchema,
  type ManagedModelProvider,
  modelProviderRefSchema,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {isAgentConfigResolutionError} from '#core/errors.js';
import {createWorkspaceAgentDefaultsResolver} from '#core/workspace-agent-defaults-resolver.js';

const resolveAgentConfigBodySchema = z.object({
  workspace_id: z.string().uuid(),
  config: z.object({
    harness: harnessSchema.optional(),
    provider: modelProviderRefSchema.optional(),
    model: z.string().min(1).optional(),
    thinking: z.string().min(1).optional(),
  }),
});

const resolveAgentConfigResponseSchema = z.object({
  harness: z.string(),
  provider: z.string(),
  model: z.string(),
  thinking: z.string(),
});

/** Resolves an agent step's settings the way run creation does, for E2E assertions. */
export function createE2eResolveAgentConfigRoute(options: {
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders: WorkspaceProvidersPolicy;
}) {
  return defineRoute({
    method: 'POST',
    path: '/resolve-agent-config',
    description: 'Resolve agent step settings for a workspace in E2E tests.',
    schema: {
      body: resolveAgentConfigBodySchema,
      response: {200: resolveAgentConfigResponseSchema},
    },
    handler: async (request) => {
      const resolve = await createWorkspaceAgentDefaultsResolver(
        request.body.workspace_id,
        options.managedProvider,
        options.workspaceProviders,
      );
      try {
        return resolve(request.body.config);
      } catch (error) {
        if (isAgentConfigResolutionError(error)) {
          throw new ClientError(error.message, 'agent-config-invalid', {status: 422});
        }
        throw error;
      }
    },
  });
}

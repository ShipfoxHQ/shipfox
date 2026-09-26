import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {createE2eModelProviderRoute} from './create-model-provider.js';
import {createE2eResolveAgentConfigRoute} from './resolve-agent-config.js';

export function createAgentE2eRoutes(
  secrets: AgentSecretsClient,
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
  managedProvider?: ManagedModelProvider | undefined,
): RouteGroup {
  return {
    prefix: '/agent',
    routes: [
      createE2eModelProviderRoute(secrets, workspaceProviderPolicy),
      createE2eResolveAgentConfigRoute({
        managedProvider,
        workspaceProviders: workspaceProviderPolicy.workspaceProviders,
      }),
    ],
  };
}

export const agentE2eRoutes = createAgentE2eRoutes(undefined as unknown as AgentSecretsClient);

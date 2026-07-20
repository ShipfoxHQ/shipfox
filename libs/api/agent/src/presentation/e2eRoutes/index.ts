import type {RouteGroup} from '@shipfox/node-fastify';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {createE2eModelProviderRoute} from './create-model-provider.js';

export function createAgentE2eRoutes(secrets: AgentSecretsClient): RouteGroup {
  return {prefix: '/agent', routes: [createE2eModelProviderRoute(secrets)]};
}

export const agentE2eRoutes = createAgentE2eRoutes(undefined as unknown as AgentSecretsClient);

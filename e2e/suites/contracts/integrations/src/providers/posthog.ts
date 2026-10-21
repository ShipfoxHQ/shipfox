import {createPosthogApiClient, PosthogAgentToolsProvider} from '@shipfox/api-integration-posthog';
import type {PosthogContractAccess} from '../fakes/posthog.js';

/** The PostHog tool adapter, with the fake's key and project in place of the database. */
export function posthogContractTools(access: PosthogContractAccess): PosthogAgentToolsProvider {
  const now = new Date();
  return new PosthogAgentToolsProvider({
    credentialStore: {getApiKey: () => Promise.resolve(access.apiKey)},
    getInstallationByConnectionId: (connectionId) =>
      Promise.resolve({
        connectionId,
        region: 'us',
        projectId: access.projectId,
        projectName: 'Contracts',
        organizationId: access.organizationId,
        keyHint: access.apiKey.slice(-4),
        credentialVersion: 1,
        createdAt: now,
        updatedAt: now,
      }),
    api: createPosthogApiClient({apiBaseUrl: access.apiBaseUrl}),
    endpoint: access.mcpEndpoint,
    markConnectionError: () => Promise.resolve(),
  });
}

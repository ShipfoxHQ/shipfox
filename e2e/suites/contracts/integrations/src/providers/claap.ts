import {ClaapAgentToolsProvider} from '@shipfox/api-integration-claap';
import type {ClaapContractAccess} from '../fakes/claap.js';

/** The Claap tool adapter, with the fake's key and sandbox workspace in place of the database. */
export function claapContractTools(access: ClaapContractAccess): ClaapAgentToolsProvider {
  const now = new Date();
  return new ClaapAgentToolsProvider({
    credentialStore: {getApiKey: () => Promise.resolve(access.apiKey)},
    getInstallationByConnectionId: (connectionId) => {
      const {workspaceId, name} = access.workspace();
      return Promise.resolve({
        connectionId,
        workspaceId,
        workspaceName: name,
        keyHint: access.apiKey.slice(-4),
        credentialVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    },
    endpoint: access.mcpEndpoint,
    markConnectionError: () => Promise.resolve(),
  });
}

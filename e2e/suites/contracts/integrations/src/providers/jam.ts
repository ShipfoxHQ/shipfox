import {JamAgentToolsProvider} from '@shipfox/api-integration-jam';
import type {JamContractAccess} from '../fakes/jam.js';

/** The Jam tool adapter, with the fake's token and user in place of the database. */
export function jamContractTools(access: JamContractAccess): JamAgentToolsProvider {
  const now = new Date();
  return new JamAgentToolsProvider({
    credentialStore: {getToken: () => Promise.resolve(access.token)},
    getInstallationByConnectionId: (connectionId) =>
      Promise.resolve({
        connectionId,
        teamId: access.teamId,
        userId: access.userId,
        userName: access.userName,
        userEmail: null,
        tokenHint: access.token.slice(-4),
        credentialVersion: 1,
        createdAt: now,
        updatedAt: now,
      }),
    endpoint: access.mcpEndpoint,
    markConnectionError: () => Promise.resolve(),
  });
}

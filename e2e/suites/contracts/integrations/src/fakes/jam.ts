import {startJamMock} from '@shipfox/e2e-harness';
import {type ContractFakeAdapter, ephemeralEndpoint} from './shared.js';

/** What the Jam tool adapter needs to call the fake as the connection's user. */
export interface JamContractAccess {
  token: string;
  teamId: string;
  userId: string;
  userName: string;
  mcpEndpoint: string;
}

/**
 * Jam, whose fake answers by token. The fake holds the two sandbox Jams, a video and a
 * screenshot, with the results Jam returned for them, so `seed` has nothing to load: a case reads
 * the same Jams from the fake that it reads from the sandbox. The connection holds a token of its
 * own. Jam is read-only for Shipfox.
 */
export const jamContractFake: ContractFakeAdapter<JamContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const mock = await startJamMock(ephemeralEndpoint());
  cleanups.push(() => mock.stop());
  const mcpEndpoint = new URL('/mcp', mock.endpoint).toString();
  return {
    env: {JAM_API_BASE_URL: mock.endpoint.toString(), JAM_MCP_ENDPOINT: mcpEndpoint},
    access: {
      token: `jam_pat_contracts_${uniqueId}`,
      teamId: `contracts-team-${uniqueId}`,
      userId: `contracts-user-${uniqueId}`,
      userName: `Contracts Jam ${uniqueId}`,
      mcpEndpoint,
    },
    seed: () => Promise.resolve(),
    writes: () => [],
  };
};

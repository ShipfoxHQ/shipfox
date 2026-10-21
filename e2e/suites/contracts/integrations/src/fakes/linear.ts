import {
  loadLinearRecordings,
  loadLinearWriteRecordings,
  startLinearMcpMock,
} from '@shipfox/e2e-driver-linear';
import type {ContractFakeAdapter} from './shared.js';

/** What the Linear tool adapter needs to call the fake as the connection's app. */
export interface LinearContractAccess {
  accessToken: string;
  endpoint: string;
}

/**
 * Linear, behind an access token the fake answers for. The fake replays the calls recorded from
 * the sandbox workspace, one text block each as the hosted MCP sends them, for the sandbox
 * fixtures the read cases name. The recordings hold the fixtures' ids and fields, so `seed` has
 * nothing to load: a case whose fixture changed in `sandbox.yaml` sends arguments with no
 * recording and fails on the fake until it is recorded again. Writes go to the fake's state,
 * which answers the reads that name what they created, so a round-trip case reads its own change.
 */
export const linearContractFake: ContractFakeAdapter<LinearContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const accessToken = `lin_oauth_contracts_${uniqueId}`;
  const mock = await startLinearMcpMock({
    accessToken,
    endpoint: new URL('http://127.0.0.1:0/mcp'),
    recordings: await loadLinearRecordings(),
    writeRecordings: await loadLinearWriteRecordings(),
  });
  cleanups.push(() => mock.stop());
  const endpoint = mock.endpoint.toString();
  return {
    env: {LINEAR_MCP_ENDPOINT: endpoint},
    access: {accessToken, endpoint},
    seed: () => Promise.resolve(),
    writes: () => mock.writes(),
  };
};

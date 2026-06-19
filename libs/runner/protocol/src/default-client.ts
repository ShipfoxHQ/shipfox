import {config} from '#config.js';
import type {RunnerProtocol} from '#contract.js';
import {createProtocolClient} from '#protocol-client.js';

// The configured client the runner app composes. This is the only file that reads
// the environment, so the contract and factory stay config-free and importable
// from tests without the runner's required variables.
export const defaultProtocolClient: RunnerProtocol = createProtocolClient({
  baseUrl: config.SHIPFOX_API_URL,
  runnerToken: config.SHIPFOX_RUNNER_TOKEN,
});

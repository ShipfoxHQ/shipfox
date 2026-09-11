import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('logs');

export type AgentDownloadRequestOutcome =
  | 'redirected'
  | 'streamed'
  | 'seam-aborted'
  | 'rejected'
  | 'over-capacity'
  | 'failed';

export const agentDownloadRequests = meter.createCounter<{
  outcome: AgentDownloadRequestOutcome;
}>('logs_agent_download_requests', {
  description: 'Token-authenticated agent log downloads by outcome',
});

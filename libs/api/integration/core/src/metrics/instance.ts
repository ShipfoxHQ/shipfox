import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('integrations');

export type IntegrationAgentToolCallOutcome =
  | 'success'
  | 'tool-error'
  | 'invalid-request'
  | 'exception';

const agentToolCallCount = meter.createCounter<{
  provider: string;
  tool: string;
  method: string;
  outcome: IntegrationAgentToolCallOutcome;
}>('integrations_agent_tool_call', {
  description: 'Integration agent tool calls by provider, tool, method, and outcome',
});

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect integration tool call outcomes.
  }
}

export function recordIntegrationAgentToolCall(params: {
  provider: string;
  tool: string;
  method: string;
  outcome: IntegrationAgentToolCallOutcome;
}): void {
  recordMetric(() => agentToolCallCount.add(1, params));
}

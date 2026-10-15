import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {DefinitionAtRefErrorCode} from '#core/errors.js';

const meter = instanceMetrics.getMeter('definitions');

export type DefinitionRefResolutionOutcome = DefinitionAtRefErrorCode | 'resolved';

/** `resolve` prepares a dev run; `validate` only checks the definition and writes nothing. */
export type DefinitionRefResolutionOperation = 'resolve' | 'validate';

const refResolutionCount = meter.createCounter<{
  outcome: DefinitionRefResolutionOutcome;
  operation: DefinitionRefResolutionOperation;
}>('definitions_ref_resolutions', {
  description: 'Workflow definition resolutions at a git ref by operation and outcome',
});

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect definition resolution outcomes.
  }
}

export function recordDefinitionRefResolution(
  outcome: DefinitionRefResolutionOutcome,
  operation: DefinitionRefResolutionOperation = 'resolve',
): void {
  recordMetric(() => refResolutionCount.add(1, {outcome, operation}));
}

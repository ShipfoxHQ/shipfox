import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('projects');

const projectsCreatedCount = meter.createCounter<Record<string, never>>('projects_created', {
  description: 'Projects created',
});

export type SourceCommitPushedOutcome =
  | 'duplicate'
  | 'non_default_branch'
  | 'observed'
  | 'unbound_source';

const sourceCommitPushedCount = meter.createCounter<{outcome: SourceCommitPushedOutcome}>(
  'projects_source_commit_pushed',
  {description: 'Source commit pushed events handled by outcome'},
);

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect project writes or subscriber acknowledgements.
  }
}

export function recordProjectCreated(): void {
  recordMetric(() => projectsCreatedCount.add(1));
}

export function recordSourceCommitPushed(outcome: SourceCommitPushedOutcome): void {
  recordMetric(() => sourceCommitPushedCount.add(1, {outcome}));
}

import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('logs');

export const recordAppendedCount = meter.createCounter<{
  kind: 'agent_session' | 'process' | 'system';
}>('logs_record_appended', {description: 'Log records appended to durable stream storage by kind'});

export const streamOpenedCount = meter.createCounter<Record<string, never>>('logs_stream_opened', {
  description: 'Log streams opened by first append',
});

export const streamClosedCount = meter.createCounter<{reason: 'declared' | 'timeout'}>(
  'logs_stream_closed',
  {description: 'Log streams closed by reason'},
);

export type CompactionMetricOutcome =
  | 'already-compacted'
  | 'compacted'
  | 'failed'
  | 'gone'
  | 'retention-raced'
  | 'superseded';

export const compactionCount = meter.createCounter<{outcome: CompactionMetricOutcome}>(
  'logs_compaction',
  {description: 'Log stream compaction attempts by outcome'},
);

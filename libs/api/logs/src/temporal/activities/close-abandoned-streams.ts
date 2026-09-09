import type {StepAttemptTerminalCauseDto} from '@shipfox/api-workflows-dto';
import {closeStream} from '#core/close-stream.js';
import {db} from '#db/db.js';
import {listOpenStreamsByJob} from '#db/streams.js';
import {
  recordAppendedCount,
  type StreamClosedMetricReason,
  streamClosedCount,
} from '#metrics/instance.js';

interface CloseAbandonedStreamsMetrics {
  recordAppended(kind: StepAttemptTerminalCauseDto): void;
  streamClosed(reason: StreamClosedMetricReason): void;
}

const defaultMetrics: CloseAbandonedStreamsMetrics = {
  recordAppended: (kind) => recordAppendedCount.add(1, {kind}),
  streamClosed: (reason) => streamClosedCount.add(1, {reason}),
};

function recordCloseMetrics(
  metrics: CloseAbandonedStreamsMetrics,
  terminalCause: StepAttemptTerminalCauseDto | null,
): void {
  if (terminalCause !== null) metrics.recordAppended(terminalCause);
  metrics.streamClosed(
    terminalCause === 'timed_out' ? 'job_timeout' : (terminalCause ?? 'abandoned'),
  );
}

/**
 * Job termination does not guarantee the runner flushed an end record: it may have
 * died, been capped, or lost its spool. Each stream closes in its own transaction
 * through the guarded `closeStream`, so a declared-close race is skipped instead of
 * writing a duplicate event or tombstone.
 */
export async function closeAbandonedStreamsActivity(
  params: {
    jobId: string;
    terminalCause?: StepAttemptTerminalCauseDto | null | undefined;
  },
  metrics: CloseAbandonedStreamsMetrics = defaultMetrics,
): Promise<{closed: number}> {
  const terminalCause = params.terminalCause === undefined ? 'runner_lost' : params.terminalCause;
  const open = await listOpenStreamsByJob(params.jobId);

  let closed = 0;
  for (const stream of open) {
    const result = await db().transaction((tx) =>
      closeStream(tx, {
        streamId: stream.id,
        reason: 'timeout',
        terminalCause,
      }),
    );
    if (result) {
      closed += 1;
      recordCloseMetrics(metrics, terminalCause);
    }
  }

  return {closed};
}

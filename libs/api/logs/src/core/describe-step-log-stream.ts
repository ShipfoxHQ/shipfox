import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {chunkStats} from '#db/chunks.js';
import {getAttemptStreamById, getStreamByStepAttempt} from '#db/streams.js';

export interface DescribeStepLogStreamParams {
  stepId: string;
  attempt: number;
}

export interface DescribedStepLogStream {
  streamId: string;
  state: 'open' | 'closed';
  compacted: boolean;
  committedLength: number;
  totalBytes: number;
  totalLines?: number;
  truncated: boolean;
}

export interface DescribeStepLogStreamDependencies {
  chunkStats: typeof chunkStats;
  getAttemptStreamById: typeof getAttemptStreamById;
  getStreamByStepAttempt: typeof getStreamByStepAttempt;
}

const defaultDependencies: DescribeStepLogStreamDependencies = {
  chunkStats,
  getAttemptStreamById,
  getStreamByStepAttempt,
};

function describeCompactedStream(stream: AttemptStream): DescribedStepLogStream {
  return {
    streamId: stream.id,
    state: stream.state,
    compacted: true,
    committedLength: stream.committedLength,
    totalBytes: stream.committedLength,
    ...(stream.lineCount === null ? {} : {totalLines: stream.lineCount}),
    truncated: stream.truncated,
  };
}

export async function describeStepLogStream(
  params: DescribeStepLogStreamParams,
  dependencies: DescribeStepLogStreamDependencies = defaultDependencies,
): Promise<DescribedStepLogStream | null> {
  const stream = await dependencies.getStreamByStepAttempt(params);
  if (!stream) return null;

  if (stream.objectKey) return describeCompactedStream(stream);

  const stats = await dependencies.chunkStats(stream.id);
  if (stats.count === 0) {
    const refreshed = await dependencies.getAttemptStreamById(stream.id);
    if (!refreshed) return null;
    if (refreshed.objectKey) return describeCompactedStream(refreshed);
  }

  return {
    streamId: stream.id,
    state: stream.state,
    compacted: false,
    committedLength: stream.committedLength,
    totalBytes: stats.uncompressedBytes,
    truncated: stream.truncated,
  };
}

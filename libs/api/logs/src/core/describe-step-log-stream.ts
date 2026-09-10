import {chunkStats} from '#db/chunks.js';
import {getStreamByStepAttempt} from '#db/streams.js';

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
  getStreamByStepAttempt: typeof getStreamByStepAttempt;
}

const defaultDependencies: DescribeStepLogStreamDependencies = {
  chunkStats,
  getStreamByStepAttempt,
};

export async function describeStepLogStream(
  params: DescribeStepLogStreamParams,
  dependencies: DescribeStepLogStreamDependencies = defaultDependencies,
): Promise<DescribedStepLogStream | null> {
  const stream = await dependencies.getStreamByStepAttempt(params);
  if (!stream) return null;

  if (stream.objectKey) {
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

  const stats = await dependencies.chunkStats(stream.id);
  return {
    streamId: stream.id,
    state: stream.state,
    compacted: false,
    committedLength: stream.committedLength,
    totalBytes: stats.uncompressedBytes,
    truncated: stream.truncated,
  };
}

import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {
  type DescribeStepLogStreamDependencies,
  describeStepLogStream,
} from './describe-step-log-stream.js';

const mocks = vi.hoisted(() => ({
  chunkStats: vi.fn(),
  getAttemptStreamById: vi.fn(),
  getStreamByStepAttempt: vi.fn(),
}));

const dependencies: DescribeStepLogStreamDependencies = {
  chunkStats: mocks.chunkStats,
  getAttemptStreamById: mocks.getAttemptStreamById,
  getStreamByStepAttempt: mocks.getStreamByStepAttempt,
};

function stream(overrides: Partial<AttemptStream> = {}): AttemptStream {
  return {
    id: 'stream-id',
    jobId: 'job-id',
    stepId: 'step-id',
    attempt: 1,
    workspaceId: 'workspace-id',
    projectId: 'project-id',
    workflowRunAttemptId: 'run-attempt-id',
    committedLength: 42,
    state: 'closed',
    closeReason: 'declared',
    declaredTotalBytes: 42,
    claudeHasInit: false,
    claudeSessionId: null,
    claudeTurn: 0,
    claudePendingResult: null,
    claudePendingToolRows: [],
    truncated: false,
    lineCount: null,
    objectKey: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    closedAt: new Date(0),
    ...overrides,
  };
}

describe('describeStepLogStream', () => {
  beforeEach(() => {
    mocks.chunkStats.mockReset();
    mocks.getAttemptStreamById.mockReset();
    mocks.getStreamByStepAttempt.mockReset();
  });

  it('returns the compacted description when compaction publishes before empty stats', async () => {
    const hot = stream();
    const compacted = stream({objectKey: 'object-key', lineCount: 3});
    mocks.getStreamByStepAttempt.mockResolvedValue(hot);
    mocks.chunkStats.mockResolvedValue({count: 0, maxSeq: 0, uncompressedBytes: 0});
    mocks.getAttemptStreamById.mockResolvedValue(compacted);

    const result = await describeStepLogStream({stepId: hot.stepId, attempt: 1}, dependencies);

    expect(result).toEqual({
      streamId: compacted.id,
      state: 'closed',
      compacted: true,
      committedLength: 42,
      totalBytes: 42,
      totalLines: 3,
      truncated: false,
    });
    expect(mocks.getAttemptStreamById).toHaveBeenCalledWith(hot.id);
  });

  it('returns null when the stream is deleted during empty stats refresh', async () => {
    const hot = stream();
    mocks.getStreamByStepAttempt.mockResolvedValue(hot);
    mocks.chunkStats.mockResolvedValue({count: 0, maxSeq: 0, uncompressedBytes: 0});
    mocks.getAttemptStreamById.mockResolvedValue(null);

    const result = await describeStepLogStream({stepId: hot.stepId, attempt: 1}, dependencies);

    expect(result).toBeNull();
    expect(mocks.getAttemptStreamById).toHaveBeenCalledWith(hot.id);
  });
});

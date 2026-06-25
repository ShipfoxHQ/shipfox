import {parseLogRecordLine} from '@shipfox/api-logs-dto';
import {db} from '#db/db.js';
import {getOrCreateAttemptStream} from '#db/streams.js';
import {listChunks, listStreamClosedEvents} from '#test/queries.js';
import {
  type FinalizeAttemptLogStreamParams,
  finalizeAttemptLogStream,
} from './finalize-attempt-stream.js';

const metrics = vi.hoisted(() => ({
  recordAppendedAdd: vi.fn(),
  streamClosedAdd: vi.fn(),
  streamOpenedAdd: vi.fn(),
}));

vi.mock('#metrics/instance.js', () => ({
  recordAppendedCount: {add: metrics.recordAppendedAdd},
  streamClosedCount: {add: metrics.streamClosedAdd},
  streamOpenedCount: {add: metrics.streamOpenedAdd},
}));

function newIdentity(
  overrides: Partial<FinalizeAttemptLogStreamParams> = {},
): FinalizeAttemptLogStreamParams {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    logOutcome: 'drained',
    ...overrides,
  };
}

describe('finalizeAttemptLogStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a missing drained stream and closes it as declared', async () => {
    const identity = newIdentity({logOutcome: 'drained'});

    const stream = await finalizeAttemptLogStream(identity);

    expect(stream.state).toBe('closed');
    expect(stream.closeReason).toBe('declared');
    expect(stream.truncated).toBe(false);
    expect(await listChunks(stream.id)).toHaveLength(0);
    expect(await listStreamClosedEvents(stream.id)).toHaveLength(1);
    expect(metrics.streamOpenedAdd).not.toHaveBeenCalled();
    expect(metrics.streamClosedAdd).toHaveBeenCalledWith(1, {reason: 'declared'});
    expect(metrics.recordAppendedAdd).not.toHaveBeenCalled();
  });

  it('closes an abandoned open stream with a runner_lost tombstone', async () => {
    const identity = newIdentity({logOutcome: 'abandoned'});
    await db().transaction((tx) => getOrCreateAttemptStream(tx, identity));

    const stream = await finalizeAttemptLogStream(identity);

    expect(stream.state).toBe('closed');
    expect(stream.closeReason).toBe('timeout');
    expect(stream.truncated).toBe(true);
    const chunks = await listChunks(stream.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.origin).toBe('control');
    const records = chunks[0]?.data
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map(parseLogRecordLine);
    expect(records).toMatchObject([{type: 'runner_lost'}]);
    expect(await listStreamClosedEvents(stream.id)).toHaveLength(1);
    expect(metrics.streamOpenedAdd).not.toHaveBeenCalled();
    expect(metrics.streamClosedAdd).toHaveBeenCalledWith(1, {reason: 'timeout'});
    expect(metrics.recordAppendedAdd).toHaveBeenCalledWith(1, {kind: 'runner_lost'});
  });

  it('does not emit another tombstone or close event when finalized again', async () => {
    const identity = newIdentity({logOutcome: 'abandoned'});

    const first = await finalizeAttemptLogStream(identity);
    const second = await finalizeAttemptLogStream(identity);

    expect(second.id).toBe(first.id);
    expect(second.state).toBe('closed');
    expect(await listChunks(first.id)).toHaveLength(1);
    expect(await listStreamClosedEvents(first.id)).toHaveLength(1);
    expect(metrics.streamOpenedAdd).not.toHaveBeenCalled();
    expect(metrics.streamClosedAdd).toHaveBeenCalledTimes(1);
    expect(metrics.recordAppendedAdd).toHaveBeenCalledTimes(1);
  });
});

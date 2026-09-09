import {parseLogRecordLine} from '@shipfox/api-logs-dto';
import {appendLogs} from '#core/append-logs.js';
import {closeAbandonedStreamsActivity as closeAbandonedStreams} from '#temporal/activities/close-abandoned-streams.js';
import {endLine, ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findStream, listChunks, listStreamClosedEvents} from '#test/queries.js';

interface Ctx {
  jobId: string;
  stepId: string;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
}

function newCtx(): Ctx {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
  };
}

describe('closeAbandonedStreamsActivity', () => {
  const recordAppended = vi.fn();
  const streamClosed = vi.fn();
  const closeAbandonedStreamsActivity = (params: Parameters<typeof closeAbandonedStreams>[0]) =>
    closeAbandonedStreams(params, {recordAppended, streamClosed});

  beforeEach(() => {
    recordAppended.mockReset();
    streamClosed.mockReset();
  });

  it.each([
    'timed_out',
    'run_cancelled',
    'runner_lost',
  ] as const)('force-closes an open stream with a %s tombstone and one event', async (terminalCause) => {
    const ctx = newCtx();
    await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody(outputLine('partial\n'))});
    const open = await findStream({...ctx, attempt: 1});

    const {closed} = await closeAbandonedStreamsActivity({jobId: ctx.jobId, terminalCause});

    expect(closed).toBe(1);
    const after = await findStream({...ctx, attempt: 1});
    expect(after?.state).toBe('closed');
    expect(after?.closeReason).toBe('timeout');
    expect(after?.truncated).toBe(true);
    expect(after?.committedLength).toBe(open?.committedLength);
    const chunks = await listChunks(after?.id as string);
    expect(chunks.map((c) => c.origin)).toEqual(['runner', 'control']);
    expect(
      chunks.flatMap((chunk) =>
        chunk.data.toString('utf8').split('\n').filter(Boolean).map(parseLogRecordLine),
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({type: terminalCause})]));
    expect(await listStreamClosedEvents(after?.id as string)).toHaveLength(1);
    expect(recordAppended).toHaveBeenCalledWith(terminalCause);
    expect(streamClosed).toHaveBeenCalledWith(
      terminalCause === 'timed_out' ? 'job_timeout' : terminalCause,
    );
  });

  it('defaults a legacy activity input without a cause to runner loss', async () => {
    const ctx = newCtx();
    await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody(outputLine('partial\n'))});

    await closeAbandonedStreamsActivity({jobId: ctx.jobId});

    const stream = await findStream({...ctx, attempt: 1});
    const chunks = await listChunks(stream?.id as string);
    expect(
      chunks.flatMap((chunk) =>
        chunk.data.toString('utf8').split('\n').filter(Boolean).map(parseLogRecordLine),
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({type: 'runner_lost'})]));
    expect(recordAppended).toHaveBeenCalledWith('runner_lost');
    expect(streamClosed).toHaveBeenCalledWith('runner_lost');
  });

  it('closes an explicitly cause-free stream as truncated without a tombstone', async () => {
    const ctx = newCtx();
    await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody(outputLine('partial\n'))});

    await closeAbandonedStreamsActivity({jobId: ctx.jobId, terminalCause: null});

    const stream = await findStream({...ctx, attempt: 1});
    expect(stream).toMatchObject({state: 'closed', closeReason: 'timeout', truncated: true});
    expect((await listChunks(stream?.id as string)).map((chunk) => chunk.origin)).toEqual([
      'runner',
    ]);
    expect(recordAppended).not.toHaveBeenCalled();
    expect(streamClosed).toHaveBeenCalledWith('abandoned');
  });

  it('closes only the still-open streams, skipping ones already declared-closed', async () => {
    const ctx = newCtx();
    const stepOpen = crypto.randomUUID();
    const stepDone = crypto.randomUUID();
    await appendLogs({
      ...ctx,
      stepId: stepDone,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('done\n'), endLine(4)),
    });
    await appendLogs({
      ...ctx,
      stepId: stepOpen,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('partial\n')),
    });
    const doneStream = await findStream({jobId: ctx.jobId, stepId: stepDone, attempt: 1});

    const {closed} = await closeAbandonedStreamsActivity({
      jobId: ctx.jobId,
      terminalCause: 'runner_lost',
    });

    expect(closed).toBe(1);
    const openAfter = await findStream({jobId: ctx.jobId, stepId: stepOpen, attempt: 1});
    expect(openAfter?.closeReason).toBe('timeout');
    expect(openAfter?.truncated).toBe(true);
    const doneAfter = await findStream({jobId: ctx.jobId, stepId: stepDone, attempt: 1});
    expect(doneAfter?.closeReason).toBe('declared');
    expect(doneAfter?.truncated).toBe(false);
    expect(await listStreamClosedEvents(doneStream?.id as string)).toHaveLength(1);
  });

  it('is a no-op for a job with no open streams', async () => {
    const ctx = newCtx();

    const {closed} = await closeAbandonedStreamsActivity({
      jobId: ctx.jobId,
      terminalCause: 'runner_lost',
    });

    expect(closed).toBe(0);
  });
});

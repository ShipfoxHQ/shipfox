import {appendLogs} from '#core/append-logs.js';
import {closeAbandonedStreamsActivity} from '#temporal/activities/close-abandoned-streams.js';
import {endLine, ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findStream, listChunks, listStreamClosedEvents} from '#test/queries.js';

interface Ctx {
  jobId: string;
  stepId: string;
  workspaceId: string;
  projectId: string;
  runId: string;
}

function newCtx(): Ctx {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
  };
}

describe('closeAbandonedStreamsActivity', () => {
  it('force-closes an open stream with a runner_lost tombstone and one event', async () => {
    const ctx = newCtx();
    await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody(outputLine('partial\n'))});
    const open = await findStream({...ctx, attempt: 1});

    const {closed} = await closeAbandonedStreamsActivity({jobId: ctx.jobId});

    expect(closed).toBe(1);
    const after = await findStream({...ctx, attempt: 1});
    expect(after?.state).toBe('closed');
    expect(after?.closeReason).toBe('timeout');
    expect(after?.truncated).toBe(true);
    expect(after?.committedLength).toBe(open?.committedLength);
    expect((await listChunks(after?.id as string)).map((c) => c.origin)).toEqual([
      'runner',
      'control',
    ]);
    expect(await listStreamClosedEvents(after?.id as string)).toHaveLength(1);
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

    const {closed} = await closeAbandonedStreamsActivity({jobId: ctx.jobId});

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

    const {closed} = await closeAbandonedStreamsActivity({jobId: ctx.jobId});

    expect(closed).toBe(0);
  });
});

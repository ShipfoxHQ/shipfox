import {appendLogs} from '#core/append-logs.js';
import {endLine, ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {getOpenStreamCount} from './streams.js';

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

describe('getOpenStreamCount', () => {
  it('reports the current open stream count', async () => {
    const before = await getOpenStreamCount();

    const after = await getOpenStreamCount();
    expect(after - before).toBe(0n);
  });

  it('counts newly opened streams without counting streams closed in the same test', async () => {
    const before = await getOpenStreamCount();
    const open = newCtx();
    const closed = newCtx();
    await appendLogs({...open, attempt: 1, offset: 0, body: ndjsonBody(outputLine('open\n'))});
    await appendLogs({
      ...closed,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('closed\n'), endLine(7)),
    });

    const after = await getOpenStreamCount();

    expect(after - before).toBe(1n);
  });
});

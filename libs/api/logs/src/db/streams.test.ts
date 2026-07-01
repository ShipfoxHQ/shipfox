import {sql} from 'drizzle-orm';
import {appendLogs} from '#core/append-logs.js';
import {db} from '#db/db.js';
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
  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE logs_chunks, logs_attempt_streams, logs_job_accounting, logs_outbox CASCADE`,
    );
  });

  it('reports zero when no streams are open', async () => {
    const count = await getOpenStreamCount();

    expect(count).toBe(0n);
  });

  it('counts only streams that are still open', async () => {
    const open = newCtx();
    const closed = newCtx();
    await appendLogs({...open, attempt: 1, offset: 0, body: ndjsonBody(outputLine('open\n'))});
    await appendLogs({
      ...closed,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('closed\n'), endLine(7)),
    });

    const count = await getOpenStreamCount();

    expect(count).toBe(1n);
  });
});

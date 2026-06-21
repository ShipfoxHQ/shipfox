import {eq, sql} from 'drizzle-orm';
import {appendLogs} from '#core/append-logs.js';
import type {CloseStreamParams} from '#core/close-stream.js';
import {db, type Transaction} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import {endLine, ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findStream, listChunks, listStreamClosedEvents} from '#test/queries.js';
import {reapStaleOpenStreamsActivity} from './reap-stale-open-streams.js';

// Mock closeStream so the failure-path test can make one row fail while every
// other test still uses the real implementation.
const {closeStreamMock} = vi.hoisted(() => ({closeStreamMock: vi.fn()}));

vi.mock('#core/close-stream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/close-stream.js')>();
  return {...actual, closeStream: closeStreamMock};
});

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

async function backdateCreatedAtPastReapWindow(streamId: string): Promise<void> {
  await db()
    .update(attemptStreams)
    .set({createdAt: sql`now() - interval '3 hours'`})
    .where(eq(attemptStreams.id, streamId));
}

describe('reapStaleOpenStreamsActivity', () => {
  let realCloseStream: (tx: Transaction, params: CloseStreamParams) => Promise<unknown>;

  beforeAll(async () => {
    const actual =
      await vi.importActual<typeof import('#core/close-stream.js')>('#core/close-stream.js');
    realCloseStream = actual.closeStream;
  });

  beforeEach(() => {
    closeStreamMock.mockImplementation((tx: Transaction, params: CloseStreamParams) =>
      realCloseStream(tx, params),
    );
  });

  it('force-closes a stale open stream with a runner_lost tombstone and one event', async () => {
    const ctx = newCtx();
    await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody(outputLine('partial\n'))});
    const open = await findStream({...ctx, attempt: 1});
    await backdateCreatedAtPastReapWindow(open?.id as string);

    const {reaped} = await reapStaleOpenStreamsActivity();

    // Activity counters are whole-table tallies; row state isolates this test from
    // unrelated stale rows in the shared test DB.
    expect(reaped).toBeGreaterThanOrEqual(1);
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

  it('leaves a recently-created open stream untouched', async () => {
    const ctx = newCtx();
    await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody(outputLine('fresh\n'))});

    await reapStaleOpenStreamsActivity();

    const after = await findStream({...ctx, attempt: 1});
    expect(after?.state).toBe('open');
  });

  it('does not select an already declared-closed stream, even an old one', async () => {
    const ctx = newCtx();
    await appendLogs({
      ...ctx,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('done\n'), endLine(5)),
    });
    const closed = await findStream({...ctx, attempt: 1});
    await backdateCreatedAtPastReapWindow(closed?.id as string);

    await reapStaleOpenStreamsActivity();

    const after = await findStream({...ctx, attempt: 1});
    expect(after?.closeReason).toBe('declared');
    expect(after?.truncated).toBe(false);
    expect(await listStreamClosedEvents(after?.id as string)).toHaveLength(1);
  });

  it('logs and skips one stream whose close fails, still reaping the rest of the batch', async () => {
    const poisonCtx = newCtx();
    const healthyCtx = newCtx();
    await appendLogs({
      ...poisonCtx,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('poison\n')),
    });
    await appendLogs({
      ...healthyCtx,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('healthy\n')),
    });
    const poison = await findStream({...poisonCtx, attempt: 1});
    const healthy = await findStream({...healthyCtx, attempt: 1});
    await backdateCreatedAtPastReapWindow(poison?.id as string);
    await backdateCreatedAtPastReapWindow(healthy?.id as string);
    closeStreamMock.mockImplementation((tx: Transaction, params: CloseStreamParams) =>
      params.streamId === poison?.id
        ? Promise.reject(new Error('induced close failure'))
        : realCloseStream(tx, params),
    );

    const {reaped, failed} = await reapStaleOpenStreamsActivity();

    expect(failed).toBeGreaterThanOrEqual(1);
    expect(reaped).toBeGreaterThanOrEqual(1);
    const healthyAfter = await findStream({...healthyCtx, attempt: 1});
    expect(healthyAfter?.state).toBe('closed');
    const poisonAfter = await findStream({...poisonCtx, attempt: 1});
    expect(poisonAfter?.state).toBe('open');

    // The mocked failure leaves this row open by design. Mark it closed through the
    // DB so later reaper tests do not inherit a stale open row.
    await db()
      .update(attemptStreams)
      .set({state: 'closed'})
      .where(eq(attemptStreams.id, poison?.id as string));
  });
});

import {Buffer} from 'node:buffer';
import type {StreamKind} from '@shipfox/api-logs-dto';
import {appendLogs} from '#core/append-logs.js';
import {LeaseStreamMismatchError, MalformedLogChunkError, OffsetGapError} from '#core/errors.js';
import {jobAccountingFactory} from '#test/factories/job-accounting.js';
import {
  endLine,
  groupStartLine,
  ndjsonBody,
  outputLine,
  outputOfBytes,
  recordLine,
  sessionLine,
} from '#test/fixtures/ndjson.js';
import {findAccounting, findStream, listChunks, listStreamClosedEvents} from '#test/queries.js';

interface Ctx {
  jobId: string;
  stepId: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  kind: StreamKind;
}

function newCtx(): Ctx {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    kind: 'log_stream',
  };
}

describe('appendLogs', () => {
  describe('offset-CAS', () => {
    it('extends committed_length and stores one runner chunk on an in-order append', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result).toEqual({committedLength: body.length, capped: false});
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.committedLength).toBe(body.length);
      const chunks = await listChunks(stream?.id as string);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.origin).toBe('runner');
    });

    it('acks a re-sent (offset < committed) append without storing a new chunk', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result).toEqual({committedLength: body.length, capped: false});
      const stream = await findStream({...ctx, attempt: 1});
      expect(await listChunks(stream?.id as string)).toHaveLength(1);
    });

    it('rejects a gap (offset > committed) with the committed length', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const error = await appendLogs({
        ...ctx,
        attempt: 1,
        offset: body.length + 5,
        body: ndjsonBody(outputLine('more\n')),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OffsetGapError);
      expect((error as OffsetGapError).committedLength).toBe(body.length);
    });

    it('rejects a straddling append (offset before committed but extending past it)', async () => {
      const ctx = newCtx();
      const first = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});

      const error = await appendLogs({
        ...ctx,
        attempt: 1,
        offset: first.length - 2,
        body: ndjsonBody(outputLine('more\n')),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OffsetGapError);
      expect((error as OffsetGapError).committedLength).toBe(first.length);
    });

    it('treats an empty body as a heartbeat that creates no stream', async () => {
      const ctx = newCtx();

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody()});

      expect(result).toEqual({committedLength: 0, capped: false});
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });
  });

  describe('budget accounting', () => {
    it('charges the raw stored bytes, envelope and control records included', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('abc'), groupStartLine('g1', 'Build'));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const accounting = await findAccounting(ctx.jobId);
      expect(accounting?.storedBytesUsed).toBe(body.length);
    });

    it('stays under cap when accrual from elapsed time covers the payload', async () => {
      const ctx = newCtx();
      await jobAccountingFactory.create({
        jobId: ctx.jobId,
        workspaceId: ctx.workspaceId,
        startedAt: new Date(Date.now() - 5 * 60_000),
      });

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body: outputOfBytes(150)});

      expect(result.capped).toBe(false);
      expect((await findAccounting(ctx.jobId))?.cappedAt).toBeNull();
    });
  });

  describe('cap', () => {
    it('caps when the payload crosses the budget, injecting a control tombstone', async () => {
      const ctx = newCtx();

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body: outputOfBytes(150)});

      expect(result.capped).toBe(true);
      expect((await findAccounting(ctx.jobId))?.cappedAt).not.toBeNull();
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['runner', 'control']);
    });

    it('drops a post-cap straggler but still advances committed_length', async () => {
      const ctx = newCtx();
      const first = outputOfBytes(150);
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});
      const straggler = ndjsonBody(outputLine('late\n'));

      const result = await appendLogs({...ctx, attempt: 1, offset: first.length, body: straggler});

      expect(result).toEqual({committedLength: first.length + straggler.length, capped: true});
      const stream = await findStream({...ctx, attempt: 1});
      expect(await listChunks(stream?.id as string)).toHaveLength(2); // runner + tombstone, no straggler
    });

    it('does not cap when stored bytes land exactly on the budget', async () => {
      const ctx = newCtx();
      const body = outputOfBytes(9);
      // Test env base budget is 100 bytes; pre-fill so this append lands used == allowed.
      await jobAccountingFactory.create({
        jobId: ctx.jobId,
        workspaceId: ctx.workspaceId,
        storedBytesUsed: 100 - body.length,
        startedAt: new Date(),
      });

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result.capped).toBe(false);
      expect((await findAccounting(ctx.jobId))?.cappedAt).toBeNull();
    });
  });

  describe('stream lifecycle', () => {
    it('declared-closes the stream and emits one stream-closed event on an end record', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('done\n'), endLine(12345));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('closed');
      expect(stream?.closeReason).toBe('declared');
      expect(stream?.truncated).toBe(false);
      expect(stream?.declaredTotalBytes).toBe(12345);
      expect(stream?.closedAt).not.toBeNull();
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(1);
    });

    it('is idempotent: a re-sent end body neither re-closes nor emits a second event', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('done\n'), endLine(10));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});
      const stream = await findStream({...ctx, attempt: 1});

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(1);
    });

    it('drops further output once declared-closed (no new chunk, committed_length frozen)', async () => {
      const ctx = newCtx();
      // End-only body so the single stored chunk stays under the 100-byte test budget
      // (an extra output line would trip the cap and add a tombstone chunk).
      const end = ndjsonBody(endLine(4));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: end});
      const closed = await findStream({...ctx, attempt: 1});

      const result = await appendLogs({
        ...ctx,
        attempt: 1,
        offset: end.length,
        body: ndjsonBody(outputLine('late\n')),
      });

      expect(result.committedLength).toBe(end.length);
      const after = await findStream({...ctx, attempt: 1});
      expect(after?.committedLength).toBe(closed?.committedLength);
      expect(await listChunks(after?.id as string)).toHaveLength(1);
    });

    it('declared-closes when one body both crosses the budget and ends', async () => {
      const ctx = newCtx();
      // 150 payload bytes cross the 100-byte test budget, but the crossing chunk is still
      // stored in full; the same body carries the end, so the stream declared-closes.
      const body = ndjsonBody(outputLine('x'.repeat(150)), endLine(4));

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result.capped).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('closed');
      expect(stream?.closeReason).toBe('declared');
      expect(stream?.truncated).toBe(false);
      expect((await listChunks(stream?.id as string)).map((c) => c.origin)).toEqual([
        'runner',
        'control',
      ]);
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(1);
    });

    it('does not declared-close when an already-capped job drops the end body', async () => {
      const ctx = newCtx();
      // Cap the job first (150 payload bytes cross the 100-byte budget), then send the end
      // body: it is dropped, so the stream is not whole and must stay open for the sweep.
      const first = outputOfBytes(150);
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});
      const end = ndjsonBody(endLine(4));

      const result = await appendLogs({...ctx, attempt: 1, offset: first.length, body: end});

      expect(result.capped).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('open');
      expect(stream?.closeReason).toBeNull();
      expect(stream?.declaredTotalBytes).toBeNull();
      // The dropped end body persisted nothing: still just the runner chunk + cap tombstone.
      expect(await listChunks(stream?.id as string)).toHaveLength(2);
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(0);
    });

    it('keeps attempts of the same step on independent streams', async () => {
      const ctx = newCtx();
      const a1 = ndjsonBody(outputLine('one\n'));
      const a2 = ndjsonBody(outputLine('two-two\n'));

      await appendLogs({...ctx, attempt: 1, offset: 0, body: a1});
      await appendLogs({...ctx, attempt: 2, offset: 0, body: a2});

      expect((await findStream({...ctx, attempt: 1}))?.committedLength).toBe(a1.length);
      expect((await findStream({...ctx, attempt: 2}))?.committedLength).toBe(a2.length);
    });
  });

  describe('concurrency and isolation', () => {
    it('serializes two concurrent first appends at offset 0 into one chunk', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('race\n'));

      const results = await Promise.all([
        appendLogs({...ctx, attempt: 1, offset: 0, body}),
        appendLogs({...ctx, attempt: 1, offset: 0, body}),
      ]);

      expect(results.every((r) => r.committedLength === body.length)).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      expect(await listChunks(stream?.id as string)).toHaveLength(1);
    });

    it('claims the cap once when two steps of one job cross the budget concurrently', async () => {
      const ctx = newCtx();
      const stepA = crypto.randomUUID();
      const stepB = crypto.randomUUID();

      await Promise.all([
        appendLogs({...ctx, stepId: stepA, attempt: 1, offset: 0, body: outputOfBytes(80)}),
        appendLogs({...ctx, stepId: stepB, attempt: 1, offset: 0, body: outputOfBytes(80)}),
      ]);

      expect((await findAccounting(ctx.jobId))?.cappedAt).not.toBeNull();
      const streamA = await findStream({jobId: ctx.jobId, stepId: stepA, attempt: 1});
      const streamB = await findStream({jobId: ctx.jobId, stepId: stepB, attempt: 1});
      const controls = [
        ...(await listChunks(streamA?.id as string)),
        ...(await listChunks(streamB?.id as string)),
      ].filter((c) => c.origin === 'control');
      expect(controls).toHaveLength(1);
    });

    it('rejects a second append whose lease workspace/project/run does not match the stamped row', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('first\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});
      const before = await findStream({...ctx, attempt: 1});

      const error = await appendLogs({
        ...ctx,
        projectId: crypto.randomUUID(),
        attempt: 1,
        offset: body.length,
        body: ndjsonBody(outputLine('more\n')),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LeaseStreamMismatchError);
      // The wrapping transaction rolls back: updated_at and committed_length on
      // the stamped row are untouched, so a stale lease cannot tick the
      // stream's freshness or advance its CAS axis.
      const after = await findStream({...ctx, attempt: 1});
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      expect(after?.committedLength).toBe(before?.committedLength);
    });

    it('isolates streams by job: a different job with the same stepId gets its own stream', async () => {
      const stepId = crypto.randomUUID();
      const jobA = crypto.randomUUID();
      const jobB = crypto.randomUUID();
      const workspaceId = crypto.randomUUID();
      const projectId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const bodyA = ndjsonBody(outputLine('a\n'));
      const bodyB = ndjsonBody(outputLine('bbbb\n'));

      const common = {
        workspaceId,
        projectId,
        runId,
        stepId,
        attempt: 1,
        offset: 0,
        kind: 'log_stream' as const,
      };
      await appendLogs({...common, jobId: jobA, body: bodyA});
      await appendLogs({...common, jobId: jobB, body: bodyB});

      const streamA = await findStream({jobId: jobA, stepId, attempt: 1});
      const streamB = await findStream({jobId: jobB, stepId, attempt: 1});
      expect(streamA?.id).not.toBe(streamB?.id);
      expect(streamA?.committedLength).toBe(bodyA.length);
      expect(streamB?.committedLength).toBe(bodyB.length);
    });
  });

  describe('write-path enforcement (log_stream)', () => {
    it.each([
      'capped',
      'runner_lost',
    ])('rejects a forged server-only %s tombstone before any row is created', async (type) => {
      const ctx = newCtx();
      const body = ndjsonBody(recordLine({type}));

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });

    it('rejects an invalid NDJSON record', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(recordLine({type: 'output', stream: 'stdout'})); // missing data

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
    });
  });

  describe('kind: agent_session', () => {
    const sessionCtx = (): Ctx => ({...newCtx(), kind: 'agent_session'});

    it('stores a session body verbatim, byte-identical, as runner-origin chunks', async () => {
      const ctx = sessionCtx();
      const body = ndjsonBody(
        sessionLine({type: 'session', version: 3}),
        sessionLine({type: 'message', role: 'assistant', text: 'hi'}),
      );

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result).toEqual({committedLength: body.length, capped: false});
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.every((c) => c.origin === 'runner')).toBe(true);
      expect(Buffer.concat(chunks.map((c) => c.data))).toEqual(body);
    });

    it('reassembles two whole-line appends byte-identically (line-aligned committed_length)', async () => {
      const ctx = sessionCtx();
      const first = ndjsonBody(sessionLine({i: 1}));
      const second = ndjsonBody(sessionLine({i: 2}));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});

      await appendLogs({...ctx, attempt: 1, offset: first.length, body: second});

      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(Buffer.concat(chunks.map((c) => c.data))).toEqual(Buffer.concat([first, second]));
    });

    it('rejects a non-newline-terminated session body', async () => {
      const ctx = sessionCtx();
      const body = Buffer.from(JSON.stringify({a: 1}), 'utf8'); // no trailing newline

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
    });

    it('rejects a non-JSON session line', async () => {
      const ctx = sessionCtx();
      const body = Buffer.from('not json\n', 'utf8');

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
    });

    it('rejects a session body with invalid UTF-8 bytes', async () => {
      const ctx = sessionCtx();
      const body = Buffer.concat([
        Buffer.from('{"a":"'),
        Buffer.from([0xff, 0xfe]),
        Buffer.from('"}\n'),
      ]);

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
    });

    it('rejects a session line over the configured byte cap', async () => {
      const ctx = sessionCtx();
      const body = ndjsonBody(sessionLine({blob: 'x'.repeat(300)})); // > 256 test cap

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
    });

    it('stores a line that looks like a control record verbatim, never interpreting it', async () => {
      const ctx = sessionCtx();
      const body = ndjsonBody(sessionLine({v: 1, ts: 1, type: 'capped'}));

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result.capped).toBe(false);
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.every((c) => c.origin === 'runner')).toBe(true);
      expect(Buffer.concat(chunks.map((c) => c.data))).toEqual(body);
    });

    it('caps over budget WITHOUT injecting an in-band tombstone', async () => {
      const ctx = sessionCtx();
      const body = ndjsonBody(sessionLine({blob: 'x'.repeat(120)})); // crosses the 100-byte budget

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result.capped).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.every((c) => c.origin === 'runner')).toBe(true); // no 'control' tombstone
    });
  });

  describe('per-kind identity', () => {
    it('keeps log_stream and agent_session on independent streams for one step', async () => {
      const ctx = newCtx();
      const logBody = ndjsonBody(outputLine('build\n'));
      const sessBody = ndjsonBody(sessionLine({type: 'session', version: 3}));

      await appendLogs({...ctx, kind: 'log_stream', attempt: 1, offset: 0, body: logBody});
      await appendLogs({...ctx, kind: 'agent_session', attempt: 1, offset: 0, body: sessBody});

      const logStream = await findStream({...ctx, attempt: 1, kind: 'log_stream'});
      const sessStream = await findStream({...ctx, attempt: 1, kind: 'agent_session'});
      expect(logStream?.id).not.toBe(sessStream?.id);
      expect(logStream?.committedLength).toBe(logBody.length);
      expect(sessStream?.committedLength).toBe(sessBody.length);
    });

    it('heartbeats per kind: an agent_session probe never reads the log_stream offset', async () => {
      const ctx = newCtx();
      const logBody = ndjsonBody(outputLine('a lot of build output\n'));
      await appendLogs({...ctx, kind: 'log_stream', attempt: 1, offset: 0, body: logBody});

      const probe = await appendLogs({
        ...ctx,
        kind: 'agent_session',
        attempt: 1,
        offset: 0,
        body: ndjsonBody(),
      });

      expect(probe.committedLength).toBe(0);
      expect(await findStream({...ctx, attempt: 1, kind: 'agent_session'})).toBeNull();
    });
  });
});

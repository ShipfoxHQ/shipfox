import {appendLogs} from '#core/append-logs.js';
import {OffsetGapError} from '#core/errors.js';
import {jobAccountingFactory} from '#test/factories/job-accounting.js';
import {controlLine, ndjsonBody, outputLine, outputOfBytes} from '#test/fixtures/ndjson.js';
import {findAccounting, findStream, listChunks} from '#test/queries.js';

interface Ctx {
  jobId: string;
  stepId: string;
  workspaceId: string;
}

function newCtx(): Ctx {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
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
      expect(chunks[0]?.kind).toBe('runner');
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
      const body = ndjsonBody(outputLine('abc'), controlLine({kind: 'group_start', name: 'Build'}));

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
      expect(chunks.map((c) => c.kind)).toEqual(['runner', 'control']);
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
    it('records declared_total_bytes from an end record without closing the stream', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('done\n'), controlLine({kind: 'end', total_bytes: 12345}));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.declaredTotalBytes).toBe(12345);
      expect(stream?.state).toBe('open');
    });

    it('lets a later end record overwrite the declared total (last wins)', async () => {
      const ctx = newCtx();
      const first = ndjsonBody(controlLine({kind: 'end', total_bytes: 100}));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});

      await appendLogs({
        ...ctx,
        attempt: 1,
        offset: first.length,
        body: ndjsonBody(controlLine({kind: 'end', total_bytes: 200})),
      });

      expect((await findStream({...ctx, attempt: 1}))?.declaredTotalBytes).toBe(200);
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
      ].filter((c) => c.kind === 'control');
      expect(controls).toHaveLength(1);
    });

    it('isolates streams by job: a different job with the same stepId gets its own stream', async () => {
      const stepId = crypto.randomUUID();
      const jobA = crypto.randomUUID();
      const jobB = crypto.randomUUID();
      const workspaceId = crypto.randomUUID();
      const bodyA = ndjsonBody(outputLine('a\n'));
      const bodyB = ndjsonBody(outputLine('bbbb\n'));

      await appendLogs({jobId: jobA, workspaceId, stepId, attempt: 1, offset: 0, body: bodyA});
      await appendLogs({jobId: jobB, workspaceId, stepId, attempt: 1, offset: 0, body: bodyB});

      const streamA = await findStream({jobId: jobA, stepId, attempt: 1});
      const streamB = await findStream({jobId: jobB, stepId, attempt: 1});
      expect(streamA?.id).not.toBe(streamB?.id);
      expect(streamA?.committedLength).toBe(bodyA.length);
      expect(streamB?.committedLength).toBe(bodyB.length);
    });
  });
});

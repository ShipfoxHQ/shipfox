import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {LogRecord} from '@shipfox/api-logs-dto';
import {logRecordSchema} from '@shipfox/api-logs-dto';
import {secretWireForms} from '@shipfox/redact';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import {AttemptSpool} from '#api/spool.js';
import {createStepLogStream} from '#core/step-log-stream.js';

const STEP_ID = '00000000-0000-0000-0000-000000000abc';

function casServer() {
  let committed = 0;
  const append: LogAppendFn = ({offset, body}) => {
    if (offset > committed)
      return Promise.resolve({status: 'conflict', committedLength: committed});
    if (offset === committed) committed += body.length;
    return Promise.resolve({status: 'committed', committedLength: committed, capped: false});
  };
  return {append, committed: () => committed};
}

// Never resolves, so the server-acked offset stays at 0 (simulates an outage).
const hangingAppend: LogAppendFn = ({signal}) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
  });

// Commits like casServer and keeps every non-empty body it accepts, so a test can
// inspect what actually crossed the wire (the zero-length probe is ignored).
function recordingServer() {
  let committed = 0;
  const bodies: Buffer[] = [];
  const append: LogAppendFn = ({offset, body}) => {
    if (offset > committed)
      return Promise.resolve({status: 'conflict', committedLength: committed});
    if (offset === committed && body.length > 0) {
      bodies.push(Buffer.from(body));
      committed += body.length;
    }
    return Promise.resolve({status: 'committed', committedLength: committed, capped: false});
  };
  return {append, bodies};
}

// Commits like casServer but flips `capped` true once committed reaches `capAt`.
function cappingServer(capAt: number) {
  let committed = 0;
  const append: LogAppendFn = ({offset, body}) => {
    if (offset > committed)
      return Promise.resolve({status: 'conflict', committedLength: committed});
    if (offset === committed) committed += body.length;
    return Promise.resolve({
      status: 'committed',
      committedLength: committed,
      capped: committed >= capAt,
    });
  };
  return {append, committed: () => committed};
}

/** Group records reduced to their addressable shape, for asserting the recovered tree. */
function groupStarts(
  records: LogRecord[],
): Array<{id: string; parent: string | null; name: string}> {
  return records.flatMap((r) =>
    r.type === 'group_start' ? [{id: r.group_id, parent: r.parent_group_id, name: r.name}] : [],
  );
}

function groupEndIds(records: LogRecord[]): string[] {
  return records.flatMap((r) => (r.type === 'group_end' ? [r.group_id] : []));
}

describe('createStepLogStream', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipfox-stream-test-'));
  });

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  async function readRecords(attempt: number): Promise<LogRecord[]> {
    const text = await readFile(join(dir, 'logs', `${STEP_ID}-${attempt}.ndjson`), 'utf8');
    return text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => logRecordSchema.parse(JSON.parse(line)));
  }

  it('spools merged output and an end record, and drains to the server', async () => {
    const server = casServer();
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 1,
      append: server.append,
      flushIntervalMs: 5,
      now: () => 1,
    });

    stream.write(Buffer.from('hello\n'), 'stdout');
    stream.write(Buffer.from('oops\n'), 'stderr');
    const {streamLength} = await stream.close();
    await stream.drain({timeoutMs: 1000});
    stream.dispose();

    const records = await readRecords(1);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'hello\n'},
      {v: 1, ts: 1, type: 'output', stream: 'stderr', data: 'oops\n'},
      {v: 1, ts: 1, type: 'end', total_bytes: 11},
    ]);
    expect(server.committed()).toBe(streamLength);
  });

  it('close() resolves with the raw stream length without waiting on upload', async () => {
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 2,
      append: hangingAppend,
      flushIntervalMs: 5,
      now: () => 1,
    });

    stream.write(Buffer.from('data\n'), 'stdout');
    const {streamLength} = await stream.close();
    stream.dispose();

    const onDisk = await readFile(join(dir, 'logs', `${STEP_ID}-2.ndjson`));
    expect(streamLength).toBe(onDisk.length);
  });

  it('drops output past the unacked-backlog cap and records a single gap', async () => {
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 3,
      append: hangingAppend, // never acks, so the backlog only grows
      flushIntervalMs: 5,
      spoolMaxBytes: 150, // fits roughly one record, not two
      now: () => 1,
    });

    stream.write(Buffer.from('a'.repeat(40)), 'stdout'); // spooled
    stream.write(Buffer.from('b'.repeat(40)), 'stdout'); // dropped
    stream.write(Buffer.from('c'.repeat(40)), 'stdout'); // dropped
    await stream.close();
    stream.dispose();

    const records = await readRecords(3);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'a'.repeat(40)},
      {v: 1, ts: 1, type: 'gap', dropped_bytes: 80},
      {v: 1, ts: 1, type: 'end', total_bytes: 40},
    ]);
  });

  it('does not drop or gap a healthy stream under the default cap', async () => {
    const server = casServer();
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 4,
      append: server.append,
      flushIntervalMs: 5,
      now: () => 1,
    });

    stream.write(Buffer.from('a'.repeat(40)), 'stdout');
    stream.write(Buffer.from('b'.repeat(40)), 'stdout');
    stream.write(Buffer.from('c'.repeat(40)), 'stdout');
    await stream.close();
    await stream.drain({timeoutMs: 1000});
    stream.dispose();

    const records = await readRecords(4);
    const gaps = records.filter((r) => r.type === 'gap');
    const end = records.find((r) => r.type === 'end');
    expect(gaps).toHaveLength(0);
    expect(end).toEqual({v: 1, ts: 1, type: 'end', total_bytes: 120});
  });

  it('stops emitting and writes no end record once the server caps the budget', async () => {
    const server = cappingServer(20);
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 5,
      append: server.append,
      flushIntervalMs: 100000, // drive flushes via drain(), not the timer
      now: () => 1,
    });

    stream.write(Buffer.from('a'.repeat(30)), 'stdout'); // crosses the cap once uploaded
    await stream.drain({timeoutMs: 1000}); // uploader learns capped

    stream.write(Buffer.from('b'.repeat(30)), 'stdout'); // no-op: capped
    await stream.close();
    await stream.drain({timeoutMs: 1000});
    stream.dispose();

    const records = await readRecords(5);
    // No runner end marker after a server cap (the cap tombstone is server-side).
    expect(records.some((r) => r.type === 'end')).toBe(false);
    const outputs = records.filter((r) => r.type === 'output');
    expect(outputs).toHaveLength(1);
    expect(outputs.every((r) => r.type === 'output' && r.data.startsWith('a'))).toBe(true);
  });

  it('records a gap then resumes output once acks free the backlog', async () => {
    let acking = false;
    let committed = 0;
    const append: LogAppendFn = ({offset, body, signal}) => {
      if (!acking)
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
        });
      if (offset > committed)
        return Promise.resolve({status: 'conflict', committedLength: committed});
      if (offset === committed) committed += body.length;
      return Promise.resolve({status: 'committed', committedLength: committed, capped: false});
    };
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 6,
      append,
      flushIntervalMs: 100000, // no background flush; control timing via drain()
      spoolMaxBytes: 150, // fits one ~96-byte record, not two
      now: () => 1,
    });

    stream.write(Buffer.from('a'.repeat(40)), 'stdout'); // spooled
    stream.write(Buffer.from('b'.repeat(40)), 'stdout'); // dropped: backlog over cap

    acking = true;
    await stream.drain({timeoutMs: 1000}); // acks the first record, freeing the backlog

    stream.write(Buffer.from('c'.repeat(40)), 'stdout'); // now fits: gap then resumed output
    await stream.close();
    await stream.drain({timeoutMs: 1000});
    stream.dispose();

    const records = await readRecords(6);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'a'.repeat(40)},
      {v: 1, ts: 1, type: 'gap', dropped_bytes: 40},
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'c'.repeat(40)},
      {v: 1, ts: 1, type: 'end', total_bytes: 80},
    ]);
  });

  it('drain returns within the deadline when the API is unreachable', async () => {
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 7,
      append: hangingAppend,
      flushIntervalMs: 100000,
      now: () => 1,
    });

    stream.write(Buffer.from('data\n'), 'stdout');
    await stream.close();

    const start = Date.now();
    await stream.drain({timeoutMs: 20});
    const elapsed = Date.now() - start;
    stream.dispose();

    expect(elapsed).toBeLessThan(900); // bounded; never blocks the report on an unreachable API
  });

  it('uploads only whole NDJSON records when output spans many flush windows', async () => {
    const server = recordingServer();
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 9,
      append: server.append,
      flushIntervalMs: 5,
      flushBytes: 150, // larger than one ~96-byte record, smaller than two
      now: () => 1,
    });

    for (let i = 0; i < 6; i++) stream.write(Buffer.from(`${'x'.repeat(40)}\n`), 'stdout');
    await stream.close();
    await stream.drain({timeoutMs: 1000});
    stream.dispose();

    // The windowing actually split the stream into several bodies...
    expect(server.bodies.length).toBeGreaterThan(1);
    // ...and not one of them is a torn line: each ends on a boundary and parses whole.
    for (const body of server.bodies) {
      expect(body.at(-1)).toBe(0x0a);
      for (const line of body.toString('utf8').split('\n').filter(Boolean)) {
        expect(() => logRecordSchema.parse(JSON.parse(line))).not.toThrow();
      }
    }
  });

  it('throws when the spool cannot be opened so the caller can abandon capture', async () => {
    // Pre-create a FILE where the logs directory should be so the spool's stat/open fails.
    const logsDir = join(dir, 'logs');
    await writeFile(logsDir, 'not a directory');

    // The open failure (a non-ENOENT stat error) surfaces here; the orchestrator catches it
    // and runs the step without capture rather than letting it crash the runner.
    const open = () =>
      createStepLogStream({
        logsDir,
        stepId: STEP_ID,
        attempt: 8,
        append: hangingAppend,
        flushIntervalMs: 100000,
        now: () => 1,
      });

    expect(open).toThrow();
  });

  it('abandons capture without crashing when a write fails mid-stream', async () => {
    // First append succeeds; a later one throws like a real fs failure (ENOSPC/EMFILE) after
    // the spool has already opened and committed bytes. This is the path the open-time test
    // above does not reach.
    let appends = 0;
    const appendSpy = vi.spyOn(AttemptSpool.prototype, 'append').mockImplementation(() => {
      appends += 1;
      if (appends >= 2) throw Object.assign(new Error('ENOSPC'), {code: 'ENOSPC'});
    });

    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 10,
      append: hangingAppend,
      flushIntervalMs: 100000,
      now: () => 1,
    });

    // The mid-stream throw originates inside the sink (the child's 'data' handler); it must be
    // swallowed, not propagated, or it would crash the whole runner. Capture is then abandoned.
    expect(() => stream.write(Buffer.from('first\n'), 'stdout')).not.toThrow();
    expect(() => stream.write(Buffer.from('second\n'), 'stdout')).not.toThrow();
    expect(() => stream.write(Buffer.from('third\n'), 'stdout')).not.toThrow();
    await expect(stream.close()).resolves.toBeDefined();
    stream.dispose();

    appendSpy.mockRestore();
  });

  it('never writes the secret or any of its wire forms to the spool', async () => {
    // Reserved characters ('/', '+', '=') so the URL-encoded form genuinely differs from the
    // literal — a base64url-shaped token's URL form equals the literal and would prove nothing.
    const secret = 'sf/rt+SECRET=12';
    const forms = secretWireForms(secret); // the exact set the masker derives, incl. the literal
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 11,
      append: hangingAppend, // the spool is written synchronously; no drain needed to inspect it
      secrets: [secret],
      flushIntervalMs: 100000,
      now: () => 1,
    });

    // Emit every derived form, alternating pipes, so each must be masked before reaching disk.
    for (const [i, form] of forms.entries()) {
      stream.write(Buffer.from(`f${i}=${form}\n`), i % 2 === 0 ? 'stdout' : 'stderr');
    }
    await stream.close();
    stream.dispose();

    // The URL form must be distinct, or this test would silently degrade to a literal check.
    expect(forms).toContain(encodeURIComponent(secret));
    expect(encodeURIComponent(secret)).not.toBe(secret);

    // Read the plaintext spool file directly: not one wire form may have reached disk.
    const raw = await readFile(join(dir, 'logs', `${STEP_ID}-11.ndjson`), 'utf8');
    for (const form of forms) {
      expect(raw).not.toContain(form);
    }
    expect(raw).toContain('***');
  });

  it('counts masked bytes (not the raw secret) in the end record total', async () => {
    const secret = 'sf_rt_SECRET123456';
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 12,
      append: hangingAppend,
      secrets: [secret],
      flushIntervalMs: 100000,
      now: () => 1,
    });

    stream.write(Buffer.from(`x=${secret}\n`), 'stdout'); // masked to 'x=***\n'
    await stream.close();
    stream.dispose();

    const records = await readRecords(12);
    const end = records.find((r) => r.type === 'end');
    expect(end).toEqual({v: 1, ts: 1, type: 'end', total_bytes: Buffer.byteLength('x=***\n')});
  });

  it('writes group markers as control records and swallows the marker lines', async () => {
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 13,
      append: hangingAppend,
      flushIntervalMs: 100000,
      now: () => 1,
    });

    stream.write(Buffer.from('::group::Install\nbuilding\n::endgroup::\n'), 'stdout');
    await stream.close();
    stream.dispose();

    const records = await readRecords(13);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'group_start', group_id: 'g1', parent_group_id: null, name: 'Install'},
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'building\n'},
      {v: 1, ts: 1, type: 'group_end', group_id: 'g1'},
      {v: 1, ts: 1, type: 'end', total_bytes: Buffer.byteLength('building\n')},
    ]);
  });

  it('drops a group record under backlog pressure rather than growing the spool unbounded', async () => {
    const stream = createStepLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt: 14,
      append: hangingAppend, // never acks, so the backlog only grows
      spoolMaxBytes: 60, // fits the first record, not the next
      flushIntervalMs: 100000,
      now: () => 1,
    });

    stream.write(Buffer.from('a'.repeat(40)), 'stdout'); // spooled (~50-byte record)
    stream.write(Buffer.from('::group::Build\n'), 'stdout'); // group_start over the cap -> dropped
    await stream.close();
    stream.dispose();

    const records = await readRecords(14);
    expect(records.some((r) => r.type === 'group_start')).toBe(false);
    expect(records.some((r) => r.type === 'gap')).toBe(true);
  });

  describe('nested groups', () => {
    function nestingStream(attempt: number) {
      return createStepLogStream({
        logsDir: join(dir, 'logs'),
        stepId: STEP_ID,
        attempt,
        append: hangingAppend,
        flushIntervalMs: 100000,
        now: () => 1,
      });
    }

    it('assigns ids and parent links for a nested group tree', async () => {
      const stream = nestingStream(20);

      stream.write(
        Buffer.from('::group::Build\n::group::Compile\ncc\n::endgroup::\n::endgroup::\n'),
        'stdout',
      );
      await stream.close();
      stream.dispose();

      const records = await readRecords(20);
      expect(groupStarts(records)).toEqual([
        {id: 'g1', parent: null, name: 'Build'},
        {id: 'g2', parent: 'g1', name: 'Compile'},
      ]);
      expect(groupEndIds(records)).toEqual(['g2', 'g1']);
    });

    it('gives sibling groups distinct ids under the same parent', async () => {
      const stream = nestingStream(21);

      stream.write(
        Buffer.from(
          '::group::A\n::group::B\n::endgroup::\n::group::C\n::endgroup::\n::endgroup::\n',
        ),
        'stdout',
      );
      await stream.close();
      stream.dispose();

      const records = await readRecords(21);
      expect(groupStarts(records)).toEqual([
        {id: 'g1', parent: null, name: 'A'},
        {id: 'g2', parent: 'g1', name: 'B'},
        {id: 'g3', parent: 'g1', name: 'C'},
      ]);
      expect(groupEndIds(records)).toEqual(['g2', 'g3', 'g1']);
    });

    it('interleaves stdout/stderr group markers under one nesting stack', async () => {
      const stream = nestingStream(22);

      stream.write(Buffer.from('::group::Outer\n'), 'stdout');
      stream.write(Buffer.from('::group::Inner\n'), 'stderr');
      stream.write(Buffer.from('::endgroup::\n'), 'stdout');
      stream.write(Buffer.from('::endgroup::\n'), 'stderr');
      await stream.close();
      stream.dispose();

      const records = await readRecords(22);
      expect(groupStarts(records)).toEqual([
        {id: 'g1', parent: null, name: 'Outer'},
        {id: 'g2', parent: 'g1', name: 'Inner'},
      ]);
      expect(groupEndIds(records)).toEqual(['g2', 'g1']);
    });

    it('ignores an unbalanced endgroup with nothing open (no underflow)', async () => {
      const stream = nestingStream(23);

      stream.write(Buffer.from('::endgroup::\nhello\n'), 'stdout');
      await stream.close();
      stream.dispose();

      const records = await readRecords(23);
      expect(groupEndIds(records)).toEqual([]);
      expect(
        records.filter((r) => r.type === 'output').map((r) => (r.type === 'output' ? r.data : '')),
      ).toEqual(['hello\n']);
    });

    it('keeps the group exactly at depth 32 real and flattens only the 33rd', async () => {
      const stream = nestingStream(24);
      // 33 opens: the 32nd fills the cap (still real), the 33rd flattens. Then 33 closes.
      const open = Array.from({length: 33}, (_, i) => `::group::G${i}\n`).join('');
      const close = '::endgroup::\n'.repeat(33);

      stream.write(Buffer.from(open + close), 'stdout');
      await stream.close();
      stream.dispose();

      const records = await readRecords(24);
      const starts = groupStarts(records);
      expect(starts).toHaveLength(32); // the 33rd flattened, no record
      expect(starts.at(-1)?.id).toBe('g32');
      expect(starts.at(-1)?.parent).toBe('g31');
    });

    it('flattens groups past the max depth and consumes the overflow before any real pop', async () => {
      const stream = nestingStream(25);
      // 34 opens (2 past the cap of 32), a leaf, then 34 closes. The 2 overflow ends must be
      // consumed by the counter before any real group_end pops, so the recovered tree is intact.
      const open = Array.from({length: 34}, (_, i) => `::group::G${i}\n`).join('');
      const close = '::endgroup::\n'.repeat(34);

      stream.write(Buffer.from(`${open}leaf\n${close}`), 'stdout');
      await stream.close();
      stream.dispose();

      const records = await readRecords(25);
      const starts = groupStarts(records);
      const ends = groupEndIds(records);
      // Only 32 real groups (g1..g32); the 2 overflow starts produced no record.
      expect(starts.map((s) => s.id)).toEqual(Array.from({length: 32}, (_, i) => `g${i + 1}`));
      // The ends are the exact reverse (g32 down to g1): no real parent was popped early by an
      // overflow end, and there is no underflow.
      expect(ends).toEqual(Array.from({length: 32}, (_, i) => `g${32 - i}`));
    });
  });
});

import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {LogRecord} from '@shipfox/api-logs-dto';
import {logRecordSchema} from '@shipfox/api-logs-dto';
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
      {v: 1, ts: 1, type: 'output', src: 'stdout', data: 'hello\n'},
      {v: 1, ts: 1, type: 'output', src: 'stderr', data: 'oops\n'},
      {v: 1, ts: 1, type: 'control', src: 'system', kind: 'end', total_bytes: 11},
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
      {v: 1, ts: 1, type: 'output', src: 'stdout', data: 'a'.repeat(40)},
      {v: 1, ts: 1, type: 'control', src: 'system', kind: 'gap', dropped_bytes: 80},
      {v: 1, ts: 1, type: 'control', src: 'system', kind: 'end', total_bytes: 40},
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
    const gaps = records.filter((r) => r.type === 'control' && r.kind === 'gap');
    const end = records.find((r) => r.type === 'control' && r.kind === 'end');
    expect(gaps).toHaveLength(0);
    expect(end).toEqual({
      v: 1,
      ts: 1,
      type: 'control',
      src: 'system',
      kind: 'end',
      total_bytes: 120,
    });
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
    expect(records.some((r) => r.type === 'control' && r.kind === 'end')).toBe(false);
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
      {v: 1, ts: 1, type: 'output', src: 'stdout', data: 'a'.repeat(40)},
      {v: 1, ts: 1, type: 'control', src: 'system', kind: 'gap', dropped_bytes: 40},
      {v: 1, ts: 1, type: 'output', src: 'stdout', data: 'c'.repeat(40)},
      {v: 1, ts: 1, type: 'control', src: 'system', kind: 'end', total_bytes: 80},
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

  it('abandons capture without crashing when the spool cannot be written', async () => {
    // Pre-create a FILE where the logs directory should be so the spool's mkdir/open throws.
    const logsDir = join(dir, 'logs');
    await writeFile(logsDir, 'not a directory');

    const stream = createStepLogStream({
      logsDir,
      stepId: STEP_ID,
      attempt: 8,
      append: hangingAppend,
      flushIntervalMs: 100000,
      now: () => 1,
    });

    // The fs failure happens inside the sink; it must be swallowed, not thrown (a throw
    // here would escape the child's 'data' handler and crash the whole runner).
    expect(() => stream.write(Buffer.from('boom\n'), 'stdout')).not.toThrow();
    expect(() => stream.write(Buffer.from('more\n'), 'stdout')).not.toThrow();
    const {streamLength} = await stream.close();
    stream.dispose();

    expect(streamLength).toBe(0);
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
});

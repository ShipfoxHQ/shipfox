import {Buffer} from 'node:buffer';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type LogRecord, logRecordSchema} from '@shipfox/api-logs-dto';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import type {FramedOutput} from '#core/framing.js';
import {createRecordSink} from '#core/record-sink.js';

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

function framedOutput(data: string): FramedOutput {
  const record = {v: 1, ts: 1, type: 'output', stream: 'stdout', data};
  return {
    bytes: Buffer.from(`${JSON.stringify(record)}\n`, 'utf8'),
    payloadBytes: Buffer.byteLength(data, 'utf8'),
  };
}

describe('createRecordSink', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipfox-record-sink-'));
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

  function open(attempt: number, overrides: Partial<Parameters<typeof createRecordSink>[0]> = {}) {
    return createRecordSink({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt,
      append: casServer().append,
      flushIntervalMs: 5,
      now: () => 1,
      ...overrides,
    });
  }

  it('spools records, ends with the summed payload total, and commits to the server', async () => {
    const server = casServer();
    const sink = open(1, {append: server.append});

    sink.spool(framedOutput('hello\n'));
    sink.spool(framedOutput('world\n'));
    const {streamLength} = sink.closeWithEnd();
    await sink.drain({timeoutMs: 1000});
    sink.dispose();

    const records = await readRecords(1);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'hello\n'},
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'world\n'},
      {v: 1, ts: 1, type: 'end', total_bytes: 12},
    ]);
    expect(server.committed()).toBe(streamLength);
  });

  it('drops records past the unacked-backlog cap and records a single gap', async () => {
    const sink = open(2, {append: hangingAppend, spoolMaxBytes: 150});

    const accepted = framedOutput('a'.repeat(40));
    const droppedA = framedOutput('b'.repeat(40));
    const droppedB = framedOutput('c'.repeat(40));

    sink.spool(accepted);
    sink.spool(droppedA);
    sink.spool(droppedB);
    sink.closeWithEnd();
    sink.dispose();

    const records = await readRecords(2);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'a'.repeat(40)},
      {v: 1, ts: 1, type: 'gap', dropped_bytes: 80},
      {v: 1, ts: 1, type: 'end', total_bytes: 40},
    ]);
  });

  it('abandons capture after fail(): later spools are no-ops and close writes no end record', async () => {
    const sink = open(3);

    sink.spool(framedOutput('before\n'));
    sink.fail(new Error('disk full'));
    sink.spool(framedOutput('after\n'));
    const {streamLength} = sink.closeWithEnd();
    sink.dispose();

    expect(sink.isFailed()).toBe(true);
    expect(streamLength).toBe(framedOutput('before\n').bytes.length);
    const records = await readRecords(3);
    expect(records).toEqual([{v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'before\n'}]);
  });

  it('is idempotent on close: a second closeWithEnd writes no second end record', async () => {
    const sink = open(4);

    sink.spool(framedOutput('x\n'));
    const first = sink.closeWithEnd();
    const second = sink.closeWithEnd();
    sink.dispose();

    expect(second.streamLength).toBe(first.streamLength);
    const records = await readRecords(4);
    expect(records.filter((r) => r.type === 'end')).toHaveLength(1);
  });
});

import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type LogRecord, logRecordSchema} from '@shipfox/api-logs-dto';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import {createSessionLogStream} from '#core/session-log-stream.js';

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

describe('createSessionLogStream', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipfox-session-stream-'));
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

  function open(
    attempt: number,
    overrides: Partial<Parameters<typeof createSessionLogStream>[0]> = {},
  ) {
    return createSessionLogStream({
      logsDir: join(dir, 'logs'),
      stepId: STEP_ID,
      attempt,
      append: casServer().append,
      flushIntervalMs: 5,
      now: () => 1,
      ...overrides,
    });
  }

  it('forwards each entry as an agent_session record in order, then an end, and commits', async () => {
    const server = casServer();
    const stream = open(1, {append: server.append});

    stream.writeEntry('{"type":"session","id":"s"}');
    stream.writeEntry('{"type":"message","id":"a"}');
    const {streamLength} = await stream.close();
    await stream.drain({timeoutMs: 1000});
    stream.dispose();

    const records = await readRecords(1);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'agent_session', data: '{"type":"session","id":"s"}'},
      {v: 1, ts: 1, type: 'agent_session', data: '{"type":"message","id":"a"}'},
      {v: 1, ts: 1, type: 'end', total_bytes: 54},
    ]);
    expect(server.committed()).toBe(streamLength);
  });

  it('drops an entry whose record exceeds the flush window and records a single gap', async () => {
    const stream = open(2, {flushBytes: 200});

    const acceptedBeforeGap = '{"type":"a"}';
    const oversizedEntry = 'y'.repeat(300);
    const acceptedAfterGap = '{"type":"b"}';

    stream.writeEntry(acceptedBeforeGap);
    stream.writeEntry(oversizedEntry);
    stream.writeEntry(acceptedAfterGap);
    await stream.close();
    stream.dispose();

    const records = await readRecords(2);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'agent_session', data: acceptedBeforeGap},
      {v: 1, ts: 1, type: 'gap', dropped_bytes: 300},
      {v: 1, ts: 1, type: 'agent_session', data: acceptedAfterGap},
      {v: 1, ts: 1, type: 'end', total_bytes: 24},
    ]);
  });

  it('masks registered secrets in the entry before it reaches the spool', async () => {
    const stream = open(3, {secrets: ['SUPERSECRET']});

    stream.writeEntry('{"text":"token=SUPERSECRET done"}');
    await stream.close();
    stream.dispose();

    const [record] = await readRecords(3);
    expect(record).toMatchObject({type: 'agent_session'});
    const data = record?.type === 'agent_session' ? record.data : '';
    expect(data).not.toContain('SUPERSECRET');
    expect(data).toContain('***');
  });

  it('ignores an empty entry', async () => {
    const stream = open(4);

    stream.writeEntry('');
    await stream.close();
    stream.dispose();

    const records = await readRecords(4);
    expect(records).toEqual([{v: 1, ts: 1, type: 'end', total_bytes: 0}]);
  });
});

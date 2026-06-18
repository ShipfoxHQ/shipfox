import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AttemptSpool} from '#api/spool.js';
import {InvalidStepIdError} from '#core/errors.js';

const STEP_ID = '00000000-0000-0000-0000-000000000001';

describe('AttemptSpool', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipfox-spool-test-'));
  });

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  it('rejects a non-UUID step id before touching the filesystem', () => {
    const open = () => AttemptSpool.open(dir, '../escape', 1);

    expect(open).toThrow(InvalidStepIdError);
  });

  it('appends bytes and tracks the written length', () => {
    const spool = AttemptSpool.open(join(dir, 'logs'), STEP_ID, 1);

    spool.append(Buffer.from('one\n'));
    spool.append(Buffer.from('two\n'));

    expect(spool.length).toBe(8);
    spool.close();
  });

  it('lazily creates the logs directory on first append', async () => {
    const logsDir = join(dir, 'logs');
    const spool = AttemptSpool.open(logsDir, STEP_ID, 2);

    spool.append(Buffer.from('hi\n'));
    spool.close();

    const onDisk = await readFile(join(logsDir, `${STEP_ID}-2.ndjson`), 'utf8');
    expect(onDisk).toBe('hi\n');
  });

  it('treats an empty append as a no-op that opens no file', async () => {
    const logsDir = join(dir, 'logs');
    const spool = AttemptSpool.open(logsDir, STEP_ID, 3);

    spool.append(Buffer.alloc(0));
    spool.close();

    expect(spool.length).toBe(0);
    // The empty append must not have opened an fd or created the spool file.
    await expect(readFile(join(logsDir, `${STEP_ID}-3.ndjson`))).rejects.toThrow();
  });

  it('reads a slice from an arbitrary offset, bounded by written length', () => {
    const spool = AttemptSpool.open(join(dir, 'logs'), STEP_ID, 1);
    spool.append(Buffer.from('abcdef'));

    const slice = spool.read(2, 3);
    const past = spool.read(6, 10);

    expect(slice.toString()).toBe('cde');
    expect(past.length).toBe(0);
    spool.close();
  });

  it('stops a windowed read at the last complete record, not mid-line', () => {
    const spool = AttemptSpool.open(join(dir, 'logs'), STEP_ID, 1);
    spool.append(Buffer.from('aaaa\nbbbb\ncccc\n'));

    // 7 bytes lands inside the second record ('aaaa\nbb'); only the first is whole.
    const chunk = spool.read(0, 7);

    expect(chunk.toString()).toBe('aaaa\n');
    spool.close();
  });

  it('returns the full window when the spool ends mid-stream on a record boundary', () => {
    const spool = AttemptSpool.open(join(dir, 'logs'), STEP_ID, 1);
    spool.append(Buffer.from('aaaa\nbbbb\n'));

    // maxBytes exceeds what is written, so the whole (boundary-terminated) tail comes back.
    const chunk = spool.read(0, 1024);

    expect(chunk.toString()).toBe('aaaa\nbbbb\n');
    spool.close();
  });

  it('yields a split record only when one line exceeds maxBytes, so the uploader never stalls', () => {
    const spool = AttemptSpool.open(join(dir, 'logs'), STEP_ID, 1);
    spool.append(Buffer.from('abcdefghij\n'));

    const chunk = spool.read(0, 4);

    expect(chunk.toString()).toBe('abcd');
    spool.close();
  });

  it('seeds length from the existing file when an attempt spool is reopened', () => {
    const logsDir = join(dir, 'logs');
    const first = AttemptSpool.open(logsDir, STEP_ID, 7);
    first.append(Buffer.from('hello\n'));
    first.close();

    const reopened = AttemptSpool.open(logsDir, STEP_ID, 7);
    reopened.append(Buffer.from('world\n'));

    expect(reopened.length).toBe(12);
    expect(reopened.read(0, 100).toString()).toBe('hello\nworld\n');
    expect(reopened.read(6, 100).toString()).toBe('world\n');
    reopened.close();
  });
});

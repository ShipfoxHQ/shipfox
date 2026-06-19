import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AttemptSpool} from '#api/spool.js';
import {InvalidStepIdError} from '#core/errors.js';

// Lets a test force a short/zero-length writeSync or a stat error without real fs conditions.
// All controls default off (statErrorCode null) so every other test hits the real fs.
const {fsControl} = vi.hoisted(() => ({
  fsControl: {splitNextWrite: false, zeroNextWrite: false, statErrorCode: null as string | null},
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const realWriteSync = actual.writeSync as (...args: unknown[]) => number;
  const realStatSync = actual.statSync as (...args: unknown[]) => unknown;
  return {
    ...actual,
    statSync: ((path: unknown, ...rest: unknown[]) => {
      if (fsControl.statErrorCode) {
        throw Object.assign(new Error('forced stat error'), {code: fsControl.statErrorCode});
      }
      return realStatSync(path, ...rest);
    }) as typeof actual.statSync,
    writeSync: ((fd: number, data: unknown, ...rest: unknown[]) => {
      if (fsControl.zeroNextWrite) {
        fsControl.zeroNextWrite = false;
        return 0;
      }
      if (fsControl.splitNextWrite && Buffer.isBuffer(data) && data.length > 1) {
        fsControl.splitNextWrite = false;
        return realWriteSync(fd, data, 0, 1); // only the first byte lands this call
      }
      return realWriteSync(fd, data, ...rest);
    }) as typeof actual.writeSync,
  };
});

const STEP_ID = '00000000-0000-0000-0000-000000000001';

describe('AttemptSpool', () => {
  let dir: string;

  beforeEach(async () => {
    fsControl.splitNextWrite = false;
    fsControl.zeroNextWrite = false;
    fsControl.statErrorCode = null;
    dir = await mkdtemp(join(tmpdir(), 'shipfox-spool-test-'));
  });

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  it('rethrows a non-ENOENT stat error rather than seeding an empty length', () => {
    // A broken path (e.g. EACCES) must not be silently treated as a fresh, empty spool, which
    // would diverge the offset state on a resume; ENOENT (a fresh attempt) is still fine.
    fsControl.statErrorCode = 'EACCES';

    const open = () => AttemptSpool.open(join(dir, 'logs'), STEP_ID, 9);

    // Assert the original error propagates (not just that something threw), so a future
    // change that swallows it or rethrows a different error is caught.
    expect(open).toThrow(expect.objectContaining({code: 'EACCES'}));
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

  it('finishes the buffer and tracks exact length when a write returns short', async () => {
    const logsDir = join(dir, 'logs');
    const spool = AttemptSpool.open(logsDir, STEP_ID, 4);

    fsControl.splitNextWrite = true; // first writeSync lands only 1 of the 6 bytes
    spool.append(Buffer.from('hello\n'));
    spool.close();

    expect(spool.length).toBe(6);
    const onDisk = await readFile(join(logsDir, `${STEP_ID}-4.ndjson`), 'utf8');
    expect(onDisk).toBe('hello\n');
  });

  it('throws when a write makes no progress, so the caller can abandon capture', () => {
    const spool = AttemptSpool.open(join(dir, 'logs'), STEP_ID, 5);

    fsControl.zeroNextWrite = true;
    const append = () => spool.append(Buffer.from('x\n'));

    expect(append).toThrow();
    spool.close();
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
    // Length and reads reflect the on-disk bytes immediately, before any append opens the fd.
    // The uploader's server-ahead check runs at probe time (pre-append), so this must hold or
    // a legitimate resume gets mistaken for the server being ahead and is dropped.
    expect(reopened.length).toBe(6);
    expect(reopened.read(0, 100).toString()).toBe('hello\n');

    reopened.append(Buffer.from('world\n'));

    expect(reopened.length).toBe(12);
    expect(reopened.read(0, 100).toString()).toBe('hello\nworld\n');
    expect(reopened.read(6, 100).toString()).toBe('world\n');
    reopened.close();
  });
});

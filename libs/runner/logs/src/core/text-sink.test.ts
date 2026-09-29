import {mkdtemp, readdir, readFile, rm, stat, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTextLogSink, TEXT_LOG_MAX_BYTES, TEXT_LOG_SEGMENT_BYTES} from '#core/text-sink.js';
import type {TransformEvent} from '#core/transform.js';

const STEP_ID = '00000000-0000-0000-0000-000000000abc';

function output(data: string): TransformEvent {
  return {type: 'output', src: 'stdout', data};
}

function textPath(dir: string, attempt: number): string {
  return join(dir, 'text', `${STEP_ID}-${attempt}.log`);
}

function requirePath(path: string | undefined): string {
  if (path === undefined) throw new Error('expected a finalized text log path');
  return path;
}

async function diskBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await diskBytes(path);
    else total += (await stat(path)).size;
  }
  return total;
}

describe('createTextLogSink', () => {
  let root: string;
  let logsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-text-sink-'));
    logsDir = join(root, 'logs');
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('renders output and group markers as plain text', async () => {
    const sink = createTextLogSink({logsDir, stepId: STEP_ID, attempt: 1});

    sink.write({type: 'group_start', name: 'Install'});
    sink.write(output('building\n'));
    sink.write({type: 'group_end'});

    const path = sink.finalize();

    expect(path).toBe(textPath(logsDir, 1));
    await expect(readFile(requirePath(path), 'utf8')).resolves.toBe(
      '::group::Install\nbuilding\n::endgroup::\n',
    );
  });

  it('starts an oversized tail at the next line boundary', async () => {
    const sink = createTextLogSink({logsDir, stepId: STEP_ID, attempt: 2});

    sink.write(output('a'.repeat(TEXT_LOG_MAX_BYTES)));
    sink.write(output('\nkept\n'));

    const path = sink.finalize();

    await expect(readFile(requirePath(path), 'utf8')).resolves.toBe(
      "[shipfox] Log truncated: dropped the first 16 MiB of this attempt's log; kept the last 16 MiB.\nkept\n",
    );
  });

  it('marks a huge unterminated line partial and keeps whole UTF-8 characters', async () => {
    const sink = createTextLogSink({logsDir, stepId: STEP_ID, attempt: 3});
    const prefix = 'x'.repeat(20);
    const suffix = 'y'.repeat(TEXT_LOG_MAX_BYTES - 3);

    sink.write(output(`${prefix.slice(0, -1)}€${suffix}`));

    const path = sink.finalize();
    const contents = await readFile(requirePath(path), 'utf8');

    expect(contents.startsWith('[shipfox] Log truncated:')).toBe(true);
    expect(contents).toContain('The first kept line is partial.\n');
    expect(contents.endsWith(suffix)).toBe(true);
    expect(
      Buffer.from(contents.slice(contents.indexOf('\n') + 1), 'utf8').toString('utf8'),
    ).not.toContain('�');
  });

  it('moves past a UTF-8 continuation byte at the cut', async () => {
    const sink = createTextLogSink({logsDir, stepId: STEP_ID, attempt: 4});
    const prefixLength = 20;
    const suffix = 'z'.repeat(TEXT_LOG_MAX_BYTES - 2);

    sink.write(output(`${'x'.repeat(prefixLength - 1)}€${suffix}`));

    const path = sink.finalize();
    const contents = await readFile(requirePath(path), 'utf8');
    const kept = contents.slice(contents.indexOf('\n') + 1);

    expect(kept).toBe(suffix);
    expect(kept.codePointAt(0)).toBe('z'.codePointAt(0));
    expect(contents).toContain('The first kept line is partial.');
  });

  it('does not write a tombstone at or under the limit', async () => {
    const sink = createTextLogSink({logsDir, stepId: STEP_ID, attempt: 5});
    const expected = 'a'.repeat(TEXT_LOG_MAX_BYTES);

    sink.write(output(expected));

    const path = sink.finalize();

    await expect(readFile(requirePath(path), 'utf8')).resolves.toBe(expected);
    expect(expected.startsWith('[shipfox]')).toBe(false);
  });

  it('keeps disk usage bounded while writing and leaves one final file', async () => {
    const sink = createTextLogSink({logsDir, stepId: STEP_ID, attempt: 6});

    sink.write(output('x'.repeat(17 * TEXT_LOG_SEGMENT_BYTES)));

    expect(await diskBytes(join(logsDir, 'text'))).toBeLessThanOrEqual(18 * TEXT_LOG_SEGMENT_BYTES);
    const path = sink.finalize();

    expect(await diskBytes(join(logsDir, 'text'))).toBeLessThanOrEqual(17 * TEXT_LOG_SEGMENT_BYTES);
    await expect(stat(requirePath(path))).resolves.toBeDefined();
    await expect(readdir(join(logsDir, 'text', `${STEP_ID}-6`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('marks a write error as failed without throwing', async () => {
    const logsDirFile = join(root, 'logs-file');
    await writeFile(logsDirFile, 'not a directory');
    const sink = createTextLogSink({logsDir: logsDirFile, stepId: STEP_ID, attempt: 7});

    expect(() => sink.write(output('cannot write'))).not.toThrow();
    expect(sink.isFailed()).toBe(true);
    expect(sink.finalize()).toBeUndefined();
  });

  it('removes a partial final file when finalization fails', async () => {
    const sink = createTextLogSink({logsDir, stepId: STEP_ID, attempt: 8});
    sink.write(output('x'.repeat(17 * TEXT_LOG_SEGMENT_BYTES)));
    const segmentDir = join(logsDir, 'text', `${STEP_ID}-8`);
    await unlink(join(segmentDir, '00000002.segment'));

    expect(sink.finalize()).toBeUndefined();
    await expect(stat(textPath(logsDir, 8))).rejects.toMatchObject({code: 'ENOENT'});
  });
});

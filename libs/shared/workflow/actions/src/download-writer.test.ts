import {createHash} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {
  createDownloadBudget,
  DownloadWriteError,
  resolveDownloadTarget,
  sanitizeDownloadFilename,
  writeDownloadedFile,
} from '#download-writer.js';

const PARTIAL_RE = /\.partial$/;

function chunks(...parts: string[]): Readable {
  return Readable.from(parts.map((part) => Buffer.from(part)));
}

function failAfter(part: string): Readable {
  return Readable.from(
    (function* () {
      yield Buffer.from(part);
      throw new Error('The connection was cut.');
    })(),
  );
}

describe('download writer', () => {
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'download-writer-')));
    workspace = join(root, 'workspace');
    await mkdir(workspace);
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  async function write(params: {destination: string; filename?: string; body?: string[]}) {
    const target = await resolveDownloadTarget({
      workspace,
      cwd: workspace,
      destination: params.destination,
    });
    return await writeDownloadedFile({
      target,
      cwd: workspace,
      filename: params.filename,
      fallbackName: 'download-call-1',
      body: chunks(...(params.body ?? ['hello'])),
      maxBytes: 1024,
    });
  }

  describe('resolveDownloadTarget', () => {
    it('creates a missing directory for a trailing slash', async () => {
      const target = await resolveDownloadTarget({
        workspace,
        cwd: workspace,
        destination: 'context/files/',
      });

      expect(target).toEqual({directory: join(workspace, 'context', 'files'), fileName: undefined});
    });

    it('splits a file destination into its directory and name', async () => {
      const target = await resolveDownloadTarget({
        workspace,
        cwd: join(workspace, 'app'),
        destination: '../out/report.pdf',
      });

      expect(target).toEqual({directory: join(workspace, 'out'), fileName: 'report.pdf'});
    });

    it.each([
      ['a parent path', '../escape/'],
      ['an absolute path', '/etc/'],
    ])('refuses %s outside the workspace', async (_label, destination) => {
      await expect(
        resolveDownloadTarget({workspace, cwd: workspace, destination}),
      ).rejects.toMatchObject({code: 'destination-not-allowed'});
    });

    it('refuses a symlink that leads out of the workspace', async () => {
      const outside = join(root, 'outside');
      await mkdir(outside);
      await symlink(outside, join(workspace, 'link'));

      await expect(
        resolveDownloadTarget({workspace, cwd: workspace, destination: 'link/nested/file.txt'}),
      ).rejects.toMatchObject({code: 'destination-not-allowed'});
      expect(await readdir(outside)).toEqual([]);
    });

    it('refuses a file destination that is a directory', async () => {
      await mkdir(join(workspace, 'files'));

      await expect(
        resolveDownloadTarget({workspace, cwd: workspace, destination: 'files'}),
      ).rejects.toMatchObject({code: 'invalid-destination'});
    });
  });

  describe('sanitizeDownloadFilename', () => {
    it.each([
      ['../../etc/passwd', 'etcpasswd'],
      ['..\\secret.txt', 'secret.txt'],
      ['.env', 'env'],
      ['re\u0000po\nrt\u007f.pdf', 'report.pdf'],
      ['  spaced name.txt ', 'spaced name.txt'],
    ])('makes %j safe', (input, expected) => {
      expect(sanitizeDownloadFilename(input)).toBe(expected);
    });

    it.each([[undefined], [''], ['...'], ['/\\']])('gives up on %j', (input) => {
      expect(sanitizeDownloadFilename(input)).toBeUndefined();
    });

    it('shortens a long name and keeps its extension', () => {
      const name = sanitizeDownloadFilename(`${'é'.repeat(300)}.pdf`) ?? '';

      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
      expect(name.endsWith('é.pdf')).toBe(true);
    });
  });

  describe('writeDownloadedFile', () => {
    it('writes the file and returns its hash and path', async () => {
      const file = await write({destination: 'files/', filename: 'notes.txt', body: ['he', 'llo']});

      expect(file).toEqual({
        path: join('files', 'notes.txt'),
        bytes: 5,
        sha256: createHash('sha256').update('hello').digest('hex'),
        filename: 'notes.txt',
      });
      expect(await readFile(join(workspace, 'files', 'notes.txt'), 'utf8')).toBe('hello');
    });

    it('falls back to the generated name without a provider filename', async () => {
      const file = await write({destination: './'});

      expect(file.filename).toBe('download-call-1');
    });

    it('adds a numbered suffix when the name is taken', async () => {
      const first = await write({destination: 'files/', filename: 'report.pdf', body: ['a']});
      const second = await write({destination: 'files/', filename: 'report.pdf', body: ['b']});
      const third = await write({destination: 'files/', filename: 'report.pdf', body: ['c']});

      expect([first.filename, second.filename, third.filename]).toEqual([
        'report.pdf',
        'report (2).pdf',
        'report (3).pdf',
      ]);
      expect(await readFile(join(workspace, 'files', 'report (3).pdf'), 'utf8')).toBe('c');
    });

    it('gives concurrent downloads of the same name different names', async () => {
      const files = await Promise.all(
        Array.from({length: 5}, () => write({destination: 'files/', filename: 'same.txt'})),
      );

      expect(new Set(files.map((file) => file.filename)).size).toBe(5);
    });

    it('replaces a file the destination names', async () => {
      await writeFile(join(workspace, 'thread.md'), 'old');

      const file = await write({destination: 'thread.md', filename: 'ignored.md', body: ['new']});

      expect(file.filename).toBe('thread.md');
      expect(await readFile(join(workspace, 'thread.md'), 'utf8')).toBe('new');
    });

    it('removes the partial file when the file passes the limit', async () => {
      const target = await resolveDownloadTarget({workspace, cwd: workspace, destination: './'});

      await expect(
        writeDownloadedFile({
          target,
          cwd: workspace,
          fallbackName: 'big',
          body: chunks('12345', '67890'),
          maxBytes: 8,
        }),
      ).rejects.toMatchObject({code: 'file-too-large'});
      expect(await readdir(workspace)).toEqual([]);
    });

    it('stops when the step budget runs out', async () => {
      const target = await resolveDownloadTarget({workspace, cwd: workspace, destination: './'});
      const budget = createDownloadBudget(6);
      const writeWithBudget = (fallbackName: string) =>
        writeDownloadedFile({
          target,
          cwd: workspace,
          fallbackName,
          body: chunks('1234'),
          maxBytes: 100,
          budget,
        });

      await writeWithBudget('first');
      const error = await writeWithBudget('second').catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(DownloadWriteError);
      expect(error).toMatchObject({code: 'download-limit-exceeded'});
      expect(await readdir(workspace)).toEqual(['first']);
    });

    it('removes the partial file when the body fails', async () => {
      const target = await resolveDownloadTarget({workspace, cwd: workspace, destination: './'});

      await expect(
        writeDownloadedFile({
          target,
          cwd: workspace,
          fallbackName: 'cut',
          body: failAfter('partial bytes'),
          maxBytes: 100,
        }),
      ).rejects.toThrow('The connection was cut.');
      const entries = await readdir(workspace);
      expect(entries.filter((entry) => PARTIAL_RE.test(entry))).toEqual([]);
      expect(entries).toEqual([]);
    });
  });
});

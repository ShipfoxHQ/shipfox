import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CacheArgumentError, HashFilesLimitError, HashFilesNoMatchError} from '#cache/errors.js';
import {HASH_FILES_RUNNER_LIMITS, hashFiles} from '#cache/hash-files.js';

describe('hashFiles', () => {
  let root: string;
  const cwd = () => join(root, 'work');
  const directories = () => ({cwd: cwd(), home: join(root, 'home'), root: '/'});

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-hash-files-'));
    await mkdir(join(root, 'work/nested'), {recursive: true});
    await mkdir(join(root, 'home'), {recursive: true});
    await writeFile(join(root, 'work/a.lock'), 'a');
    await writeFile(join(root, 'work/nested/b.lock'), 'b');
    await writeFile(join(root, 'home/.npmrc'), 'h');
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('keeps the hash it has always produced', async () => {
    const result = await hashFiles({
      patterns: ['**/*.lock', '~/.npmrc'],
      directories: directories(),
    });

    expect(result).toEqual({hash: 'fadc80c6633d2268667f522f7307c080', files: 3});
  });

  it('hashes a file matched by two patterns once, whatever the pattern order', async () => {
    const once = await hashFiles({patterns: ['**/*.lock'], directories: directories()});
    const twice = await hashFiles({
      patterns: ['nested/b.lock', '**/*.lock', 'a.lock'],
      directories: directories(),
    });

    expect(twice).toEqual(once);
  });

  it('skips directories and dangling symlinks', async () => {
    await symlink('missing-target', join(cwd(), 'dangling.lock'));
    await mkdir(join(cwd(), 'dir.lock'));

    const result = await hashFiles({patterns: ['*.lock'], directories: directories()});

    expect(result.files).toBe(1);
  });

  it('hashes with the working directory alone', async () => {
    const result = await hashFiles({patterns: ['a.lock'], directories: {cwd: cwd()}});

    expect(result.files).toBe(1);
  });

  it.each([
    ['~/.npmrc'],
    ['/etc/hosts'],
  ])('throws a CacheArgumentError for %s when its anchor directory is not given', async (pattern) => {
    await expect(hashFiles({patterns: [pattern], directories: {cwd: cwd()}})).rejects.toThrow(
      CacheArgumentError,
    );
  });

  it('throws a HashFilesNoMatchError, which is a CacheArgumentError, when nothing matches', async () => {
    const failure = hashFiles({patterns: ['*.nothing'], directories: directories()});

    await expect(failure).rejects.toThrow(HashFilesNoMatchError);
    await expect(failure).rejects.toThrow(CacheArgumentError);
    await expect(failure).rejects.toThrow(
      'hashFiles matched no files for *.nothing. A key built from nothing would be shared by every run.',
    );
  });

  it('throws a HashFilesLimitError when more files match than allowed', async () => {
    const failure = hashFiles({
      patterns: ['**/*.lock'],
      directories: directories(),
      limits: {maxFiles: 1, maxBytes: 1024},
    });

    await expect(failure).rejects.toMatchObject({name: 'HashFilesLimitError', limit: 'files'});
    await expect(failure).rejects.toThrow(
      'hashFiles matched more than 1 files, the files limit, for **/*.lock. Use a narrower pattern',
    );
  });

  it('throws a HashFilesLimitError when the files are larger than allowed', async () => {
    await writeFile(join(cwd(), 'big.lock'), 'x'.repeat(2048));

    const failure = hashFiles({
      patterns: ['big.lock'],
      directories: directories(),
      limits: {maxFiles: 10, maxBytes: 1024},
    });

    await expect(failure).rejects.toBeInstanceOf(HashFilesLimitError);
    await expect(failure).rejects.toMatchObject({limit: 'bytes'});
    await expect(failure).rejects.toThrow(
      'hashFiles read more than 1 KiB, the bytes limit, for big.lock.',
    );
  });

  it('stays within the limits it reaches exactly', async () => {
    const result = await hashFiles({
      patterns: ['**/*.lock'],
      directories: directories(),
      limits: {maxFiles: 2, maxBytes: 2},
    });

    expect(result.files).toBe(2);
  });

  it('exports the runner limits', () => {
    expect(HASH_FILES_RUNNER_LIMITS).toEqual({maxFiles: 10_000, maxBytes: 1024 ** 3});
  });
});

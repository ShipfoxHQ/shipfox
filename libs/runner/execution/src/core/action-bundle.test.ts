import {mkdtemp, readFile, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {actionBundleDirectoryName, encodeActionBundle} from '@shipfox/workflow-document';
import {
  actionsDirectory,
  prepareActionBundle,
  prepareStepActionBundle,
} from '#core/action-bundle.js';

const MODE_BITS = 0o777;
const RESTRICTIVE_UMASK = 0o077;

let jobTempDir: string;
let previousUmask: number;

beforeEach(async () => {
  jobTempDir = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-action-bundle-')));
});

afterEach(async () => {
  process.umask(previousUmask);
  await rm(jobTempDir, {recursive: true, force: true});
});

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & MODE_BITS;
}

describe('prepareActionBundle', () => {
  it('lets any user read a shared bundle, whatever the umask', async () => {
    const bundle = await encodeActionBundle({
      files: [
        {path: 'index.js', content: 'export default {};\n'},
        {path: 'lib/util.js', content: 'export const util = 1;\n'},
      ],
    });
    previousUmask = process.umask(RESTRICTIVE_UMASK);

    const target = await prepareActionBundle({
      jobTempDir,
      digest: bundle.digest,
      load: () => Promise.resolve(bundle.gzip),
      shared: true,
    });

    expect(await modeOf(join(jobTempDir, 'actions'))).toBe(0o755);
    expect(await modeOf(target)).toBe(0o755);
    expect(await modeOf(join(target, 'lib'))).toBe(0o755);
    expect(await modeOf(join(target, 'index.js'))).toBe(0o444);
    expect(await modeOf(join(target, 'lib', 'util.js'))).toBe(0o444);
    expect(await modeOf(join(target, 'package.json'))).toBe(0o444);
  });
});

describe('prepareStepActionBundle', () => {
  it('extracts the composite action bundle into the actions directory', async () => {
    const bundle = await encodeActionBundle({
      files: [{path: 'build.js', content: 'console.log(1);\n'}],
    });
    const load = vi.fn(() => Promise.resolve(bundle.gzip));

    const result = await prepareStepActionBundle({
      config: {run: 'node build.js', action_bundles: [bundle.digest]},
      jobTempDir,
      load,
    });

    expect(result).toBeUndefined();
    expect(load).toHaveBeenCalledWith(bundle.digest);
    const target = join(actionsDirectory(jobTempDir), actionBundleDirectoryName(bundle.digest));
    expect(await readFile(join(target, 'build.js'), 'utf8')).toBe('console.log(1);\n');
  });

  it('extracts the bundle of every composite that holds the step', async () => {
    const outer = await encodeActionBundle({files: [{path: 'outer.txt', content: 'outer'}]});
    const inner = await encodeActionBundle({files: [{path: 'inner.txt', content: 'inner'}]});
    const gzipByDigest = new Map([
      [outer.digest, outer.gzip],
      [inner.digest, inner.gzip],
    ]);

    const result = await prepareStepActionBundle({
      config: {run: 'cat', action_bundles: [outer.digest, inner.digest]},
      jobTempDir,
      load: (digest) => Promise.resolve(gzipByDigest.get(digest) ?? new Uint8Array()),
    });

    expect(result).toBeUndefined();
    const read = (digest: string, path: string) =>
      readFile(join(actionsDirectory(jobTempDir), actionBundleDirectoryName(digest), path), 'utf8');
    expect(await read(outer.digest, 'outer.txt')).toBe('outer');
    expect(await read(inner.digest, 'inner.txt')).toBe('inner');
  });

  it('does nothing for a step without a composite action bundle', async () => {
    const load = vi.fn(() => Promise.resolve(new Uint8Array()));

    const result = await prepareStepActionBundle({config: {run: 'echo'}, jobTempDir, load});

    expect(result).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('fails the step when the bundle cannot be loaded', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;

    const result = await prepareStepActionBundle({
      config: {action_bundles: [digest]},
      jobTempDir,
      load: () => Promise.reject(new Error('Action bundle load failed with status 404')),
    });

    expect(result).toEqual({
      success: false,
      error: {
        message:
          'The composite action files could not be loaded: Action bundle load failed with status 404',
        reason: 'action_unavailable',
      },
      exit_code: null,
    });
  });

  it('fails the step when the bundle digest is invalid', async () => {
    const load = vi.fn(() => Promise.resolve(new Uint8Array()));

    const result = await prepareStepActionBundle({
      config: {action_bundles: ['not-a-digest']},
      jobTempDir,
      load,
    });

    expect(result).toMatchObject({success: false, error: {reason: 'action_unavailable'}});
    expect(load).not.toHaveBeenCalled();
  });
});

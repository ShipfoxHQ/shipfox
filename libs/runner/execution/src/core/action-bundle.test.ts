import {mkdtemp, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeActionBundle} from '@shipfox/workflow-document';
import {prepareActionBundle} from '#core/action-bundle.js';

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

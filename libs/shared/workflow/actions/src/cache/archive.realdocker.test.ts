import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Needs Docker. The archive code runs under Node in the image, against the image's own `tar`.
const NODE_MAJOR = process.versions.node.split('.')[0];
const IMAGES = [
  ['GNU tar', `node:${NODE_MAJOR}-bookworm-slim`],
  ['BusyBox tar', `node:${NODE_MAJOR}-alpine`],
] as const;
// The parent of this package, so the relative link to @shipfox/workflow-document resolves.
const WORKFLOW_DIR = fileURLToPath(new URL('../../../', import.meta.url));

const SCRIPT = `
import {lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {createArchive, extractArchive, readArchiveHeader} from '/workflow/actions/dist/cache/archive.js';

const write = (path, content) => {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), {recursive: true});
  writeFileSync(path, content);
};
write('/tmp/a/work/node_modules/pkg/index.js', 'module');
symlinkSync('pkg/index.js', '/tmp/a/work/node_modules/link.js');
write('/tmp/a/home/.npm/entry', 'home');
write('/tmp/abs/tool', 'absolute');
mkdirSync('/tmp/scratch', {recursive: true});

const archive = await createArchive({
  file: '/tmp/archive',
  scratchDirectory: '/tmp/scratch',
  segments: [
    {anchor: 'cwd', directory: '/tmp/a/work', members: ['node_modules']},
    {anchor: 'home', directory: '/tmp/a/home', members: ['.npm']},
    {anchor: 'root', directory: '/', members: ['tmp/abs']},
  ],
  maxBytes: 1024 * 1024,
  signal: undefined,
});
rmSync('/tmp/abs', {recursive: true});
for (const dir of ['/tmp/b/work', '/tmp/b/home']) mkdirSync(dir, {recursive: true});
const header = await readArchiveHeader('/tmp/archive', archive.bytes);
await extractArchive({
  file: '/tmp/archive',
  header,
  directories: {cwd: '/tmp/b/work', home: '/tmp/b/home', root: '/'},
  signal: undefined,
});

const result = {
  module: readFileSync('/tmp/b/work/node_modules/pkg/index.js', 'utf8'),
  isLink: lstatSync('/tmp/b/work/node_modules/link.js').isSymbolicLink(),
  target: readlinkSync('/tmp/b/work/node_modules/link.js'),
  home: readFileSync('/tmp/b/home/.npm/entry', 'utf8'),
  absolute: readFileSync('/tmp/abs/tool', 'utf8'),
};
console.log('RESULT ' + JSON.stringify(result));
`;

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore', timeout: 10_000});
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerAvailable())(
  'the segments-1 archive with the tar of a container image',
  () => {
    let scriptDir: string;

    beforeAll(async () => {
      scriptDir = await mkdtemp(join(tmpdir(), 'shipfox-archive-docker-'));
      await writeFile(join(scriptDir, 'script.mjs'), SCRIPT);
    });

    afterAll(async () => {
      await rm(scriptDir, {recursive: true, force: true});
    });

    it.each(IMAGES)(
      'round-trips three anchors and a symlink with %s',
      (_name, image) => {
        const output = execFileSync(
          'docker',
          [
            'run',
            '--rm',
            '-v',
            `${WORKFLOW_DIR}:/workflow:ro`,
            '-v',
            `${join(scriptDir, 'script.mjs')}:/script.mjs:ro`,
            image,
            'node',
            '/script.mjs',
          ],
          {encoding: 'utf8', timeout: 120_000},
        );

        const line = output.split('\n').find((candidate) => candidate.startsWith('RESULT '));
        expect(JSON.parse(line?.slice('RESULT '.length) ?? 'null')).toEqual({
          module: 'module',
          isLink: true,
          target: 'pkg/index.js',
          home: 'home',
          absolute: 'absolute',
        });
      },
      180_000,
    );
  },
);

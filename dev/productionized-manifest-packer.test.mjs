import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, test} from 'node:test';
import {pathToFileURL} from 'node:url';

const roots = [];
const helperUrl = pathToFileURL(resolve('dev/productionized-manifest-packer.mjs')).href;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {force: true, recursive: true})));
});

test('terminates an interrupted pack child before restoring its manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-productionized-manifest-packer-'));
  roots.push(root);
  const manifestPath = join(root, 'package.json');
  const childPidPath = join(root, 'child.pid');
  const workerPath = join(root, 'worker.mjs');
  const sourceManifest = `${JSON.stringify({imports: {'#*': './src/*'}}, null, 2)}\n`;
  await writeFile(manifestPath, sourceManifest);
  await writeFile(
    workerPath,
    `import {createProductionManifestPacker, run} from ${JSON.stringify(helperUrl)};

const [manifestPath, childPidPath] = process.argv.slice(2);
const manifestPacker = createProductionManifestPacker();
await manifestPacker.pack(manifestPath, {imports: {'#*': {development: './src/*', default: './dist/*'}}}, (signal) =>
  run(process.execPath, ['--input-type=module', '--eval', \`import {writeFile} from 'node:fs/promises'; await writeFile(${JSON.stringify(childPidPath)}, String(process.pid)); setInterval(() => {}, 1_000);\`], process.cwd(), {signal, stdio: 'ignore'}),
);
`,
  );
  const worker = spawn(process.execPath, [workerPath, manifestPath, childPidPath], {
    stdio: 'ignore',
  });

  const childPid = Number(await waitForFile(childPidPath));
  const exit = waitForExit(worker);
  worker.kill('SIGTERM');

  const {signal} = await exit;
  await waitForProcessExit(childPid);

  assert.equal(signal, 'SIGTERM');
  assert.equal(await readFile(manifestPath, 'utf8'), sourceManifest);
});

async function waitForFile(path) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return readFile(path, 'utf8');
    } catch {
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function waitForExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({code, signal}));
  });
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await delay(20);
    } catch {
      return;
    }
  }
  throw new Error(`Process ${pid} remained alive after cancellation`);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

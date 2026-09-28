import {execFileSync} from 'node:child_process';
import {mkdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {
  createShellFixture,
  readCommandLog,
  type ShellFixture,
  writeExecutable,
  writeLoggedCommand,
} from './fixtures/shell.js';

const script = new URL('../scripts/build/install-node.sh', import.meta.url).pathname;
const SHASUMS = [
  `${'a'.repeat(64)}  node-v24.18.0-linux-arm64.tar.gz`,
  `${'b'.repeat(64)}  node-v24.18.0-linux-arm64.tar.xz`,
  `${'c'.repeat(64)}  node-v24.18.0-linux-x64.tar.xz`,
].join('\\n');

async function createInstallNodeFixture(): Promise<ShellFixture> {
  const fixture = await createShellFixture(['sed']);
  await mkdir(join(fixture.root, 'tmp'), {recursive: true});
  await mkdir(join(fixture.root, 'usr/local'), {recursive: true});
  await writeExecutable(join(fixture.commandDirectory, 'dpkg'), '#!/bin/sh\necho arm64\n');
  await writeExecutable(
    join(fixture.commandDirectory, 'node'),
    `#!/bin/sh\nprintf "%s\\n" "\${RUNNER_BASE_NODE_VERSION:-v24.17.0}"\n`,
  );
  await writeLoggedCommand(
    fixture,
    'curl',
    `case "$*" in *SHASUMS256.txt*) printf "\${RUNNER_BASE_NODE_SHASUMS-${SHASUMS}}\\n" ;; esac\n`,
  );
  for (const command of ['tar', 'rm', 'corepack']) {
    await writeLoggedCommand(fixture, command);
  }
  return fixture;
}

describe('runner base Node installation', () => {
  let fixture: ShellFixture;

  beforeEach(async () => {
    fixture = await createInstallNodeFixture();
  });

  afterEach(async () => {
    await rm(fixture.root, {force: true, recursive: true});
  });

  function installNode(environment: NodeJS.ProcessEnv = {}): void {
    execFileSync('/bin/sh', [script], {
      env: {...fixture.environment, ...environment},
      stdio: 'pipe',
    });
  }

  it('keeps an installed Node of the pinned major without downloading it again', async () => {
    installNode();

    expect(await readCommandLog(fixture)).toEqual(['corepack enable']);
  });

  it('installs the latest release of the pinned major when another major is present', async () => {
    installNode({RUNNER_BASE_NODE_VERSION: 'v22.20.0'});

    const events = await readCommandLog(fixture);
    expect(events[0]).toContain('https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt');
    expect(events[1]).toContain(
      'https://nodejs.org/dist/latest-v24.x/node-v24.18.0-linux-arm64.tar.xz',
    );
    expect(events[2]).toContain(`--directory ${join(fixture.root, 'usr/local')}`);
    expect(events.at(-1)).toBe('corepack enable');
  });

  it('installs Node when it is missing', async () => {
    await rm(join(fixture.commandDirectory, 'node'));

    installNode();

    expect((await readCommandLog(fixture))[1]).toContain('node-v24.18.0-linux-arm64.tar.xz');
  });

  it('fails when no release of the pinned major matches the architecture', () => {
    expect(() =>
      installNode({RUNNER_BASE_NODE_VERSION: 'v22.20.0', RUNNER_BASE_NODE_SHASUMS: ''}),
    ).toThrow('No Node 24 release found for linux-arm64');
  });
});

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

async function createInstallNodeFixture(): Promise<ShellFixture> {
  const fixture = await createShellFixture();
  await mkdir(join(fixture.root, 'tmp'), {recursive: true});
  await mkdir(join(fixture.root, 'usr/local'), {recursive: true});
  await writeExecutable(join(fixture.commandDirectory, 'dpkg'), '#!/bin/sh\necho arm64\n');
  await writeExecutable(
    join(fixture.commandDirectory, 'node'),
    `#!/bin/sh\nprintf "%s\\n" "\${RUNNER_BASE_NODE_VERSION:-v24.17.0}"\n`,
  );
  for (const command of ['curl', 'tar', 'rm', 'corepack']) {
    await writeLoggedCommand(fixture, command);
  }
  fixture.environment.NODE_VERSION = '24.17.0';
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

  it('keeps an installed pinned Node without downloading it again', async () => {
    installNode();

    expect(await readCommandLog(fixture)).toEqual(['corepack enable']);
  });

  it('installs the pinned Node when another version is present', async () => {
    installNode({RUNNER_BASE_NODE_VERSION: 'v24.16.0'});

    const events = await readCommandLog(fixture);
    expect(events[0]).toContain(
      'https://nodejs.org/dist/v24.17.0/node-v24.17.0-linux-arm64.tar.xz',
    );
    expect(events[1]).toContain(`--directory ${join(fixture.root, 'usr/local')}`);
    expect(events.at(-1)).toBe('corepack enable');
  });
});

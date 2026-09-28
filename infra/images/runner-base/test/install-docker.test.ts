import {execFileSync} from 'node:child_process';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  createShellFixture,
  pathExists,
  readCommandLog,
  readScriptPackages,
  type ShellFixture,
  writeExecutable,
  writeLoggedCommand,
} from './fixtures/shell.js';

const script = new URL('../scripts/build/install-docker.sh', import.meta.url).pathname;
const verifyScript = new URL('../scripts/verify/verify-instance.sh', import.meta.url).pathname;

async function createInstallDockerFixture(): Promise<ShellFixture> {
  const fixture = await createShellFixture(['cat', 'chmod', 'install', 'rm']);
  await mkdir(join(fixture.root, 'etc/apt/sources.list.d'), {recursive: true});
  await mkdir(join(fixture.root, 'var/lib/apt/lists'), {recursive: true});
  await writeFile(join(fixture.root, 'etc/os-release'), 'ID=ubuntu\nVERSION_CODENAME=noble\n');
  await writeLoggedCommand(fixture, 'apt-get');
  await writeLoggedCommand(fixture, 'curl', 'for output; do :; done\nprintf key > "$output"\n');
  await writeExecutable(join(fixture.commandDirectory, 'dpkg'), '#!/bin/sh\necho arm64\n');
  return fixture;
}

describe('runner base Docker installation', () => {
  let fixture: ShellFixture;

  beforeEach(async () => {
    fixture = await createInstallDockerFixture();
  });

  afterEach(async () => {
    await rm(fixture.root, {force: true, recursive: true});
  });

  function installDocker(): void {
    execFileSync('/bin/sh', [script], {env: fixture.environment, stdio: 'pipe'});
  }

  it("installs Docker Engine, Buildx, and Compose from Docker's apt repository", async () => {
    installDocker();

    const events = await readCommandLog(fixture);
    expect(events[0]).toContain('https://download.docker.com/linux/ubuntu/gpg');
    expect(events.slice(1)).toEqual([
      'apt-get update',
      'apt-get install --yes --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
      'apt-get clean',
    ]);
    expect(await readFile(join(fixture.root, 'etc/apt/keyrings/docker.asc'), 'utf8')).toBe('key');
    expect(
      await readFile(join(fixture.root, 'etc/apt/sources.list.d/docker.sources'), 'utf8'),
    ).toBe(
      [
        'Types: deb',
        'URIs: https://download.docker.com/linux/ubuntu',
        'Suites: noble',
        'Components: stable',
        'Architectures: arm64',
        'Signed-By: /etc/apt/keyrings/docker.asc',
        '',
      ].join('\n'),
    );
  });

  it('clears the apt indexes it downloaded before the snapshot', async () => {
    const index = join(fixture.root, 'var/lib/apt/lists/download.docker.com_Packages');
    await writeFile(index, 'Package: docker-ce\n');

    installDocker();

    expect(await pathExists(index)).toBe(false);
  });

  it('verifies every package the installation installs', async () => {
    const installed = await readScriptPackages(script, 'docker-ce', 'docker-compose-plugin');
    const verified = await readScriptPackages(verifyScript, 'docker-ce', 'docker-compose-plugin');

    expect(verified).toEqual(installed);
  });
});

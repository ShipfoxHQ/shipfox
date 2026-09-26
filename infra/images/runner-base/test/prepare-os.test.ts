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

const script = new URL('../scripts/build/prepare-os.sh', import.meta.url).pathname;
const verifyScript = new URL('../scripts/verify/verify-instance.sh', import.meta.url).pathname;

async function createPrepareOsFixture(): Promise<ShellFixture> {
  const fixture = await createShellFixture(['ln']);
  for (const path of [
    'snap/amazon-ssm-agent',
    'snap/core22',
    'snap/snapd',
    'var/lib/snapd',
    'var/lib/apt/lists',
    'etc/cloud',
    'etc/default',
    'usr/bin',
    'usr/local/bin',
  ]) {
    await mkdir(join(fixture.root, path), {recursive: true});
  }
  await writeLoggedCommand(
    fixture,
    'apt-get',
    `if [ "$1" = purge ] && [ "\${3:-}" = snapd ] && [ -n "\${RUNNER_BASE_FAIL_PURGE:-}" ]; then
  exit 1
fi
`,
  );
  await writeLoggedCommand(fixture, 'systemctl', '[ "$1" = stop ]\n');
  await writeLoggedCommand(
    fixture,
    'umount',
    `if [ "\${RUNNER_BASE_FAIL_UMOUNT:-}" = "$1" ]; then\n  exit 1\nfi\n`,
  );
  await writeLoggedCommand(fixture, 'rm', 'exec /bin/rm "$@"\n');
  await writeExecutable(join(fixture.commandDirectory, 'fdfind'), '#!/bin/sh\nexit 0\n');
  return fixture;
}

function runPrepareOs(fixture: ShellFixture, environment: NodeJS.ProcessEnv = {}): void {
  execFileSync('/bin/sh', [script], {env: {...fixture.environment, ...environment}, stdio: 'pipe'});
}

describe('runner base OS preparation', () => {
  let fixture: ShellFixture;

  beforeEach(async () => {
    fixture = await createPrepareOsFixture();
  });

  afterEach(async () => {
    await rm(fixture.root, {force: true, recursive: true});
  });

  it('installs the OS packages and keeps cloud-init for new-instance bootstrap', async () => {
    runPrepareOs(fixture);

    const events = await readCommandLog(fixture);
    expect(events[0]).toBe('apt-get update');
    expect(
      events.find((event) => event.startsWith('apt-get install --yes --no-install-recommends ')),
    ).toContain('amazon-ec2-utils ec2-instance-connect');
    expect(events).not.toContain('apt-get purge --yes cloud-init');
    expect(events.some((event) => event.includes('upgrade'))).toBe(false);
    expect(await pathExists(join(fixture.root, 'etc/cloud'))).toBe(true);
    expect(await readFile(join(fixture.root, 'etc/default/locale'), 'utf8')).toBe('LANG=C.UTF-8\n');
  });

  it('unmounts seeded snaps, purges snapd, and removes its image state', async () => {
    runPrepareOs(fixture, {RUNNER_BASE_FAIL_UMOUNT: join(fixture.root, 'snap/amazon-ssm-agent')});

    const events = await readCommandLog(fixture);
    const stopIndex = events.indexOf(
      'systemctl stop snapd.seeded.service snapd.service snapd.socket',
    );
    const purgeIndex = events.indexOf('apt-get purge --yes snapd');
    const unmountEvents = events.filter((event) => event.startsWith('umount '));

    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(purgeIndex).toBeGreaterThan(stopIndex);
    expect(unmountEvents).toHaveLength(5);
    expect(unmountEvents).toContain(`umount -l ${join(fixture.root, 'snap/amazon-ssm-agent')}`);
    expect(unmountEvents.every((event) => events.indexOf(event) < purgeIndex)).toBe(true);
    expect(await pathExists(join(fixture.root, 'snap'))).toBe(false);
    expect(await pathExists(join(fixture.root, 'var/lib/snapd'))).toBe(false);
  });

  it('clears the apt package cache and indexes before the snapshot', async () => {
    const index = join(fixture.root, 'var/lib/apt/lists/archive.ubuntu.com_Packages');
    await writeFile(index, 'Package: example\n');

    runPrepareOs(fixture);

    expect(await readCommandLog(fixture)).toContain('apt-get clean');
    expect(await pathExists(index)).toBe(false);
  });

  it('fails the bake when the snapd purge fails', async () => {
    expect(() => runPrepareOs(fixture, {RUNNER_BASE_FAIL_PURGE: '1'})).toThrow();

    expect(await pathExists(join(fixture.root, 'snap'))).toBe(true);
  });

  it('fails the bake when snapd artifacts remain after purge', async () => {
    await writeExecutable(join(fixture.root, 'usr/bin/snap'), '#!/bin/sh\nexit 0\n');

    expect(() => runPrepareOs(fixture)).toThrow();
  });

  it('fails the bake when snap remains available on PATH', async () => {
    await writeExecutable(join(fixture.commandDirectory, 'snap'), '#!/bin/sh\nexit 0\n');

    expect(() => runPrepareOs(fixture)).toThrow();
  });

  it('verifies every package the preparation installs', async () => {
    const installed = await readScriptPackages(script, 'ca-certificates', 'ec2-instance-connect');
    const verified = await readScriptPackages(verifyScript, 'ca-certificates', 'cloud-init');

    expect(verified).toEqual([...installed, 'cloud-init']);
  });
});

import {execFileSync} from 'node:child_process';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  createShellFixture,
  pathExists,
  readCommandLog,
  type ShellFixture,
  writeLoggedCommand,
} from './fixtures/shell.js';

const script = new URL('../scripts/build/clean-identity.sh', import.meta.url).pathname;

async function createIdentityFixture(): Promise<ShellFixture> {
  const fixture = await createShellFixture(['find', 'truncate']);
  for (const path of ['etc/ssh', 'home/ubuntu/.ssh', 'root/.ssh', 'var/lib/cloud/instances/i-1']) {
    await mkdir(join(fixture.root, path), {recursive: true});
  }
  await writeFile(join(fixture.root, 'etc/machine-id'), '0123456789abcdef0123456789abcdef\n');
  await writeFile(join(fixture.root, 'etc/hostname'), 'ip-10-0-0-1\n');
  await writeFile(join(fixture.root, 'etc/ssh/ssh_host_ed25519_key'), 'private\n');
  await writeFile(join(fixture.root, 'etc/ssh/ssh_host_ed25519_key.pub'), 'public\n');
  await writeFile(join(fixture.root, 'etc/ssh/sshd_config'), 'PasswordAuthentication no\n');
  await writeFile(join(fixture.root, 'home/ubuntu/.ssh/authorized_keys'), 'packer\n');
  await writeFile(join(fixture.root, 'root/.ssh/authorized_keys'), 'packer\n');
  // cloud-init clean removes the instance link; the fake mirrors that effect on the fixture root.
  await writeLoggedCommand(
    fixture,
    'cloud-init',
    `[ -n "\${RUNNER_BASE_KEEP_CLOUD_STATE:-}" ] || /bin/rm -rf "$RUNNER_BASE_ROOT/var/lib/cloud"\n`,
  );
  await writeLoggedCommand(fixture, 'rm', 'exec /bin/rm "$@"\n');
  await mkdir(join(fixture.root, 'var/lib/cloud/instance'), {recursive: true});
  return fixture;
}

describe('runner base identity cleanup', () => {
  let fixture: ShellFixture;

  beforeEach(async () => {
    fixture = await createIdentityFixture();
  });

  afterEach(async () => {
    await rm(fixture.root, {force: true, recursive: true});
  });

  it('returns the base to a first-boot identity without the build key', async () => {
    execFileSync('/bin/sh', [script], {env: fixture.environment, stdio: 'pipe'});

    expect(await readCommandLog(fixture)).toContain('cloud-init clean --logs');
    expect(await readFile(join(fixture.root, 'etc/machine-id'), 'utf8')).toBe('');
    expect(await pathExists(join(fixture.root, 'etc/hostname'))).toBe(false);
    expect(await pathExists(join(fixture.root, 'etc/ssh/ssh_host_ed25519_key'))).toBe(false);
    expect(await pathExists(join(fixture.root, 'etc/ssh/ssh_host_ed25519_key.pub'))).toBe(false);
    expect(await pathExists(join(fixture.root, 'etc/ssh/sshd_config'))).toBe(true);
    expect(await pathExists(join(fixture.root, 'home/ubuntu/.ssh/authorized_keys'))).toBe(false);
    expect(await pathExists(join(fixture.root, 'root/.ssh/authorized_keys'))).toBe(false);
    expect(await pathExists(join(fixture.root, 'var/lib/cloud/instance'))).toBe(false);
  });

  it('fails the bake when cloud-init instance state survives', () => {
    expect(() =>
      execFileSync('/bin/sh', [script], {
        env: {...fixture.environment, RUNNER_BASE_KEEP_CLOUD_STATE: '1'},
        stdio: 'pipe',
      }),
    ).toThrow('cloud-init instance state remains');
  });
});

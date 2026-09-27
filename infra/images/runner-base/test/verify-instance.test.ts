import {execFileSync} from 'node:child_process';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  createShellFixture,
  readScriptPackages,
  type ShellFixture,
  writeExecutable,
  writeLoggedCommand,
} from './fixtures/shell.js';

const script = new URL('../scripts/verify/verify-instance.sh', import.meta.url).pathname;
const prepareScript = new URL('../scripts/build/prepare-os.sh', import.meta.url).pathname;

async function installedPackages(): Promise<string> {
  const packages = await readScriptPackages(
    prepareScript,
    'ca-certificates',
    'ec2-instance-connect',
  );
  return [...packages, 'cloud-init'].join(' ');
}

async function createVerifyFixture(): Promise<ShellFixture> {
  const fixture = await createShellFixture(['find', 'grep']);
  await mkdir(join(fixture.root, 'etc/ssh'), {recursive: true});
  await writeFile(join(fixture.root, 'etc/os-release'), 'ID=ubuntu\nVERSION_CODENAME=noble\n');
  await writeFile(join(fixture.root, 'etc/machine-id'), 'fedcba9876543210fedcba9876543210\n');
  await writeFile(join(fixture.root, 'etc/ssh/ssh_host_ed25519_key'), 'private\n');

  await writeLoggedCommand(
    fixture,
    'cloud-init',
    `printf "status: %s\\n" "\${RUNNER_BASE_CLOUD_INIT_STATUS:-done}"\nexit "\${RUNNER_BASE_CLOUD_INIT_EXIT:-0}"\n`,
  );
  await writeExecutable(
    join(fixture.commandDirectory, 'dpkg'),
    `#!/bin/sh\nprintf "%s\\n" "\${RUNNER_BASE_DPKG_ARCHITECTURE:-amd64}"\n`,
  );
  await writeExecutable(
    join(fixture.commandDirectory, 'dpkg-query'),
    `#!/bin/sh
for package; do :; done
case " $RUNNER_BASE_INSTALLED_PACKAGES " in
  *" $package "*) printf 'install ok installed' ;;
  *) exit 1 ;;
esac
`,
  );
  await writeExecutable(
    join(fixture.commandDirectory, 'id'),
    `#!/bin/sh\n[ -n "\${RUNNER_BASE_SHIPFOX_USER:-}" ]\n`,
  );
  for (const command of ['uname', 'systemd-analyze', 'df']) {
    await writeExecutable(join(fixture.commandDirectory, command), '#!/bin/sh\necho fixture\n');
  }
  fixture.environment.RUNNER_BASE_INSTALLED_PACKAGES = await installedPackages();
  await writeExecutable(
    join(fixture.commandDirectory, 'node'),
    `#!/bin/sh\nprintf "%s\\n" "\${RUNNER_BASE_NODE_VERSION:-v24.17.0}"\n`,
  );
  fixture.environment.SHIPFOX_RUNNER_BASE_ARCHITECTURE = 'amd64';
  fixture.environment.SHIPFOX_RUNNER_BASE_NODE_VERSION = '24.17.0';
  return fixture;
}

describe('runner base fresh-instance verification', () => {
  let fixture: ShellFixture;

  beforeEach(async () => {
    fixture = await createVerifyFixture();
  });

  afterEach(async () => {
    await rm(fixture.root, {force: true, recursive: true});
  });

  function verify(environment: NodeJS.ProcessEnv = {}): string {
    return execFileSync('/bin/sh', [script], {
      encoding: 'utf8',
      env: {...fixture.environment, ...environment},
      stdio: 'pipe',
    });
  }

  it('accepts a new instance that satisfies the base contract', () => {
    expect(verify()).toContain('runner base verified: ubuntu24/amd64');
  });

  it('accepts cloud-init completion with recoverable warnings', () => {
    expect(verify({RUNNER_BASE_CLOUD_INIT_EXIT: '2'})).toContain('runner base verified');
  });

  it.each([
    ['cloud-init failed', {RUNNER_BASE_CLOUD_INIT_EXIT: '1'}, 'cloud-init failed'],
    ['cloud-init did not finish', {RUNNER_BASE_CLOUD_INIT_STATUS: 'running'}, 'did not finish'],
    ['the architecture differs', {RUNNER_BASE_DPKG_ARCHITECTURE: 'arm64'}, 'expected amd64'],
    ['the shipfox user exists', {RUNNER_BASE_SHIPFOX_USER: '1'}, 'shipfox user'],
  ])('fails when %s', (_label, environment, message) => {
    expect(() => verify(environment)).toThrow(message);
  });

  it('fails when the instance kept an empty machine identity', async () => {
    await writeFile(join(fixture.root, 'etc/machine-id'), '');

    expect(() => verify()).toThrow('machine-id');
  });

  it('fails when a required package is missing', () => {
    const packages = String(fixture.environment.RUNNER_BASE_INSTALLED_PACKAGES);

    expect(() =>
      verify({RUNNER_BASE_INSTALLED_PACKAGES: packages.replace(' cloud-init', '')}),
    ).toThrow('required package is missing: cloud-init');
  });

  it('fails when snapd remains installed', () => {
    const packages = `${fixture.environment.RUNNER_BASE_INSTALLED_PACKAGES} snapd`;

    expect(() => verify({RUNNER_BASE_INSTALLED_PACKAGES: packages})).toThrow('snapd');
  });

  it('fails when the base holds another Node version', () => {
    expect(() => verify({RUNNER_BASE_NODE_VERSION: 'v24.18.0'})).toThrow(
      'Node is v24.18.0, expected v24.17.0',
    );
  });

  it('fails when Node is missing', async () => {
    await rm(join(fixture.commandDirectory, 'node'));

    expect(() => verify()).toThrow('Node is missing');
  });

  it('fails when a Shipfox runtime path exists', async () => {
    await mkdir(join(fixture.root, 'opt/runner'), {recursive: true});

    expect(() => verify()).toThrow('opt/runner');
  });
});

import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';

import {
  composeProjectName,
  createWorktreeServices,
  defineWorktreeServices,
  findStalePortLeases,
  leasePortBlock,
  parseEnvFile,
  portsFromBase,
  removeStalePortLeases,
  resolveComposeFile,
  resolvePortRange,
  standardAppEnv,
  standardPorts,
} from '../dist/index.js';

const longShipfoxProjectName = /^shipfox-a+-[a-f0-9]{8}$/u;
const normalizedShipfoxProjectName = /^shipfox-kolkata-workspace-[a-f0-9]{8}$/u;
const fallbackShipfoxProjectName = /^shipfox-workspace-[a-f0-9]{8}$/u;
const rangeConfigError = /must be configured together/u;
const missingComposeFileError = /Missing/u;

describe('portsFromBase', () => {
  test('assigns standard offsets from the base port', () => {
    assert.deepEqual(portsFromBase(20_000), {
      base: 20_000,
      client: 20_000,
      api: 20_001,
      postgres: 20_002,
      temporal: 20_003,
      docs: 20_004,
      garageS3: 20_005,
      giteaHttp: 20_006,
      giteaSsh: 20_007,
      otelInstanceMetrics: 20_008,
      otelServiceMetrics: 20_009,
      linearMcp: 20_010,
      githubApi: 20_011,
      slackApi: 20_012,
      otelTemporalMetrics: 20_013,
    });
  });
});

describe('composeProjectName', () => {
  test('uses the workspace name in a Compose project name', () => {
    assert.match(composeProjectName('/tmp/Kolkata ! Workspace'), normalizedShipfoxProjectName);
  });

  test('caps project names at the Docker Compose limit with a stable hash suffix', () => {
    const projectName = composeProjectName(`/tmp/${'a'.repeat(100)}`);
    assert.equal(projectName.length, 63);
    assert.match(projectName, longShipfoxProjectName);
  });

  test('keeps long workspace names distinct after truncation', () => {
    const first = composeProjectName(`/tmp/${'a'.repeat(100)}`);
    const second = composeProjectName(`/other/${'a'.repeat(100)}`);
    assert.notEqual(first, second);
    assert.equal(first.length, 63);
    assert.equal(second.length, 63);
  });

  test('uses a fallback when normalization removes every character', () => {
    assert.match(composeProjectName('/tmp/!!!'), fallbackShipfoxProjectName);
  });
});

describe('standardAppEnv', () => {
  test('sets standard service URLs from resolved ports', () => {
    const env = standardAppEnv(portsFromBase(20_000));
    assert.equal(env.SHIPFOX_RUNNER_API_URL, 'http://host.docker.internal:20001');
    assert.equal(env.SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS, 'host.docker.internal:host-gateway');
    assert.equal(env.SHIPFOX_DOCS_PORT, '20004');
    assert.equal(env.LINEAR_MCP_ENDPOINT, 'http://127.0.0.1:20010/mcp');
    assert.equal(env.GITHUB_API_BASE_URL, 'http://127.0.0.1:20011');
    assert.equal(env.SLACK_API_BASE_URL, 'http://127.0.0.1:20012');
  });
});

describe('resolvePortRange', () => {
  test('uses the default range when no overrides are configured', () => {
    assert.deepEqual(resolvePortRange({}), {start: 20_000, end: 45_999, blockSize: 20});
  });

  test('reads repository-specific range bounds from the environment', () => {
    assert.deepEqual(
      resolvePortRange({
        SHIPFOX_PORT_RANGE_START: '30000',
        SHIPFOX_PORT_RANGE_END: '30999',
      }),
      {start: 30_000, end: 30_999, blockSize: 20},
    );
  });

  test('requires both range bounds', () => {
    assert.throws(() => resolvePortRange({SHIPFOX_PORT_RANGE_START: '30000'}), rangeConfigError);
  });
});

describe('resolveComposeFile', () => {
  test('prefers the workspace compose file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'shipfox-worktree-services-'));
    try {
      const workspaceDir = join(tempDir, 'workspace');
      const rootDir = join(tempDir, 'root');
      const workspaceComposeFile = join(workspaceDir, 'compose.yml');
      mkdirSync(workspaceDir);
      mkdirSync(rootDir);
      writeFileSync(workspaceComposeFile, '');
      writeFileSync(join(rootDir, 'compose.yml'), '');
      assert.equal(
        resolveComposeFile({
          composeFile: 'compose.yml',
          workspacePath: workspaceDir,
          rootPath: rootDir,
          allowRootFallback: true,
        }),
        workspaceComposeFile,
      );
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  test('falls back to the root compose file for archive cleanup', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'shipfox-worktree-services-'));
    try {
      const workspaceDir = join(tempDir, 'workspace');
      const rootDir = join(tempDir, 'root');
      const rootComposeFile = join(rootDir, 'compose.yml');
      mkdirSync(workspaceDir);
      mkdirSync(rootDir);
      writeFileSync(rootComposeFile, '');
      assert.equal(
        resolveComposeFile({
          composeFile: 'compose.yml',
          workspacePath: workspaceDir,
          rootPath: rootDir,
          allowRootFallback: true,
        }),
        rootComposeFile,
      );
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });
});

test('parseEnvFile parses simple dotenv-style entries', () => {
  assert.deepEqual(parseEnvFile('\n# generated\nSHIPFOX_CLIENT_PORT=55290\nEMPTY=\ninvalid\n'), {
    SHIPFOX_CLIENT_PORT: '55290',
    EMPTY: '',
  });
});

test('does not allocate state when the Compose file is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-worktree-services-'));
  const workspace = join(root, 'workspace');
  const registryFile = join(root, 'shipfox-port-leases.json');
  mkdirSync(workspace);
  try {
    const services = createWorktreeServices(
      defineWorktreeServices({
        composeFile: 'missing.yml',
        ports: standardPorts,
        compose: {services: []},
      }),
      {env: {}, registryFile, workspacePath: workspace},
    );
    assert.throws(() => services.up(), missingComposeFileError);
    assert.equal(existsSync(registryFile), false);
    assert.equal(existsSync(join(workspace, '.context/local-services')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('port leases', () => {
  test('allocates 20-port blocks and reuses a workspace lease', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(root, 'shipfox-port-leases.json');
    const firstWorkspace = join(root, 'first');
    const secondWorkspace = join(root, 'second');
    mkdirSync(firstWorkspace);
    mkdirSync(secondWorkspace);
    try {
      assert.equal(leasePortBlock({workspacePath: firstWorkspace, registryFile}), 20_000);
      assert.equal(leasePortBlock({workspacePath: firstWorkspace, registryFile}), 20_000);
      assert.equal(leasePortBlock({workspacePath: secondWorkspace, registryFile}), 20_020);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('supports multiple configured ranges without overlapping leased blocks', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(root, 'shipfox-port-leases.json');
    const firstWorkspace = join(root, 'first');
    const secondWorkspace = join(root, 'second');
    const thirdWorkspace = join(root, 'third');
    mkdirSync(firstWorkspace);
    mkdirSync(secondWorkspace);
    mkdirSync(thirdWorkspace);
    const firstRange = {start: 30_000, end: 30_059, blockSize: 20};
    const overlappingRange = {start: 30_020, end: 30_079, blockSize: 20};
    try {
      assert.equal(
        leasePortBlock({workspacePath: firstWorkspace, registryFile, portRange: firstRange}),
        30_000,
      );
      assert.equal(
        leasePortBlock({workspacePath: secondWorkspace, registryFile, portRange: firstRange}),
        30_020,
      );
      assert.equal(
        leasePortBlock({workspacePath: thirdWorkspace, registryFile, portRange: overlappingRange}),
        30_040,
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('keeps a Conductor workspace lease after the workspace is renamed', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(root, 'shipfox-port-leases.json');
    const originalWorkspace = join(root, 'original');
    const renamedWorkspace = join(root, 'renamed');
    mkdirSync(originalWorkspace);
    try {
      assert.equal(
        leasePortBlock({
          workspaceId: 'conductor-workspace-123',
          workspacePath: originalWorkspace,
          registryFile,
        }),
        20_000,
      );
      renameSync(originalWorkspace, renamedWorkspace);
      assert.equal(
        leasePortBlock({
          workspaceId: 'conductor-workspace-123',
          workspacePath: renamedWorkspace,
          registryFile,
        }),
        20_000,
      );
      assert.deepEqual(findStalePortLeases({registryFile}), []);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('migrates a legacy path-keyed lease without a stored workspace path', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(root, 'shipfox-port-leases.json');
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    writeFileSync(
      registryFile,
      `${JSON.stringify({
        version: 1,
        range: {start: 20_000, end: 45_999, blockSize: 20},
        nextBase: 20_020,
        leases: {[workspace]: {base: 20_000, allocatedAt: '2026-07-22T00:00:00.000Z'}},
      })}\n`,
    );
    try {
      assert.equal(
        leasePortBlock({
          workspaceId: 'conductor-workspace-123',
          workspacePath: workspace,
          registryFile,
        }),
        20_000,
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('reports and removes only leases whose workspace no longer exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(root, 'shipfox-port-leases.json');
    const activeWorkspace = join(root, 'active');
    const deletedWorkspace = join(root, 'deleted');
    mkdirSync(activeWorkspace);
    mkdirSync(deletedWorkspace);
    try {
      leasePortBlock({workspacePath: activeWorkspace, registryFile});
      leasePortBlock({workspacePath: deletedWorkspace, registryFile});
      rmSync(deletedWorkspace, {recursive: true, force: true});
      const staleLeases = findStalePortLeases({registryFile});
      assert.equal(staleLeases.length, 1);
      assert.equal(staleLeases[0].workspacePath, deletedWorkspace);
      removeStalePortLeases(staleLeases, {registryFile});
      assert.deepEqual(findStalePortLeases({registryFile}), []);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('releases the registry lock when the registry is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(root, 'shipfox-port-leases.json');
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    writeFileSync(registryFile, '{invalid');
    try {
      assert.throws(() => leasePortBlock({workspacePath: workspace, registryFile}));
      assert.equal(existsSync(join(root, 'shipfox-port-leases.lock')), false);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});

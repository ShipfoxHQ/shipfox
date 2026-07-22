import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';

import {
  appEnv,
  composeProjectName,
  findStalePortLeases,
  leasePortBlock,
  parseEnvFile,
  portsFromBase,
  removeStalePortLeases,
  resolveComposeFile,
} from './worktree-services.mjs';

const longShipfoxProjectName = /^shipfox-a+-[a-f0-9]{8}$/;

describe('portsFromBase', () => {
  test('assigns stable offsets from the base port', () => {
    const ports = portsFromBase(20_000);

    assert.deepEqual(ports, {
      base: 20_000,
      client: 20_000,
      api: 20_001,
      postgres: 20_002,
      temporal: 20_003,
      docs: 20_004,
      garageS3: 20_005,
      giteaHttp: 20_006,
      giteaSsh: 20_007,
      otelInstance: 20_008,
      otelService: 20_009,
      linearMcp: 20_010,
      githubApi: 20_011,
      slackApi: 20_012,
      otelTemporal: 20_013,
    });
  });
});

describe('composeProjectName', () => {
  test('normalizes workspace names into Compose project names', () => {
    const projectName = composeProjectName('Kolkata ! Workspace');

    assert.equal(projectName, 'shipfox-kolkata-workspace-f5f09833');
  });

  test('caps project names at the Docker Compose limit with a stable hash suffix', () => {
    const projectName = composeProjectName('a'.repeat(100));

    assert.equal(projectName.length, 63);
    assert.match(projectName, longShipfoxProjectName);
  });

  test('keeps long workspace names distinct after truncation', () => {
    const first = composeProjectName(`${'a'.repeat(100)}-first`);
    const second = composeProjectName(`${'a'.repeat(100)}-second`);

    assert.notEqual(first, second);
    assert.equal(first.length, 63);
    assert.equal(second.length, 63);
  });

  test('uses a fallback when normalization removes every character', () => {
    const projectName = composeProjectName('!!!');

    assert.equal(projectName, 'shipfox-workspace-e84c538e');
  });
});

describe('appEnv', () => {
  test('sets runner container host access for worktree APIs', () => {
    const env = appEnv(portsFromBase(20_000));

    assert.equal(env.SHIPFOX_RUNNER_API_URL, 'http://host.docker.internal:20001');
    assert.equal(env.SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS, 'host.docker.internal:host-gateway');
    assert.equal(env.SHIPFOX_DOCS_PORT, '20004');
    assert.equal(env.LINEAR_MCP_ENDPOINT, 'http://127.0.0.1:20010/mcp');
    assert.equal(env.GITHUB_API_BASE_URL, 'http://127.0.0.1:20011');
    assert.equal(env.SLACK_API_BASE_URL, 'http://127.0.0.1:20012');
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

      const composeFile = resolveComposeFile({
        workspacePath: workspaceDir,
        rootPath: rootDir,
        allowRootFallback: true,
      });

      assert.equal(composeFile, workspaceComposeFile);
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

      const composeFile = resolveComposeFile({
        workspacePath: workspaceDir,
        rootPath: rootDir,
        allowRootFallback: true,
      });

      assert.equal(composeFile, rootComposeFile);
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });
});

describe('parseEnvFile', () => {
  test('parses simple dotenv-style entries', () => {
    const env = parseEnvFile(`
      # generated
      SHIPFOX_CLIENT_PORT=55290
      EMPTY=
      URL=http://localhost:3900/path?x=1
      invalid
    `);

    assert.deepEqual(env, {
      SHIPFOX_CLIENT_PORT: '55290',
      EMPTY: '',
      URL: 'http://localhost:3900/path?x=1',
    });
  });
});

describe('port leases', () => {
  test('allocates 20-port blocks and reuses a workspace lease', () => {
    const registryDirectory = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(registryDirectory, 'shipfox-port-leases.json');
    const firstWorkspace = join(registryDirectory, 'first');
    const secondWorkspace = join(registryDirectory, 'second');
    mkdirSync(firstWorkspace);
    mkdirSync(secondWorkspace);

    try {
      assert.equal(leasePortBlock({workspacePath: firstWorkspace, registryFile}), 20_000);
      assert.equal(leasePortBlock({workspacePath: firstWorkspace, registryFile}), 20_000);
      assert.equal(leasePortBlock({workspacePath: secondWorkspace, registryFile}), 20_020);
    } finally {
      rmSync(registryDirectory, {recursive: true, force: true});
    }
  });

  test('reports and removes only leases whose workspace no longer exists', () => {
    const registryDirectory = mkdtempSync(join(tmpdir(), 'shipfox-port-leases-'));
    const registryFile = join(registryDirectory, 'shipfox-port-leases.json');
    const activeWorkspace = join(registryDirectory, 'active');
    const deletedWorkspace = join(registryDirectory, 'deleted');
    mkdirSync(activeWorkspace);
    mkdirSync(deletedWorkspace);

    try {
      leasePortBlock({workspacePath: activeWorkspace, registryFile});
      leasePortBlock({workspacePath: deletedWorkspace, registryFile});
      rmSync(deletedWorkspace, {recursive: true});

      const staleLeases = findStalePortLeases({registryFile});

      assert.equal(staleLeases.length, 1);
      assert.equal(staleLeases[0].workspacePath, deletedWorkspace);
      assert.equal(staleLeases[0].base, 20_020);
      removeStalePortLeases(staleLeases, {registryFile});
      assert.deepEqual(findStalePortLeases({registryFile}), []);
    } finally {
      rmSync(registryDirectory, {recursive: true, force: true});
    }
  });
});

import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';

import {
  appEnv,
  composeProjectName,
  parseBasePort,
  parseEnvFile,
  parsePort,
  portsFromBase,
  resolveComposeFile,
} from './worktree-services.mjs';

const longShipfoxProjectName = /^shipfox-a+-[a-f0-9]{8}$/;

describe('portsFromBase', () => {
  test('assigns stable offsets from the base port', () => {
    const ports = portsFromBase(65_000);

    assert.deepEqual(ports, {
      base: 65_000,
      client: 65_000,
      api: 65_001,
      postgres: 65_002,
      temporal: 65_003,
      docs: 65_004,
      garageS3: 65_005,
      giteaHttp: 65_006,
      giteaSsh: 65_007,
      otelInstance: 65_008,
      otelService: 65_009,
      linearMcp: 65_010,
      githubApi: 65_011,
      slackApi: 65_012,
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
    const env = appEnv(portsFromBase(55_290));

    assert.equal(env.SHIPFOX_RUNNER_API_URL, 'http://host.docker.internal:55291');
    assert.equal(env.SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS, 'host.docker.internal:host-gateway');
    assert.equal(env.SHIPFOX_DOCS_PORT, '55294');
    assert.equal(env.LINEAR_MCP_ENDPOINT, 'http://127.0.0.1:55300/mcp');
    assert.equal(env.GITHUB_API_BASE_URL, 'http://127.0.0.1:55301');
    assert.equal(env.SLACK_API_BASE_URL, 'http://127.0.0.1:55302');
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

describe('parsePort', () => {
  test('accepts TCP port bounds', () => {
    assert.equal(parsePort('1'), 1);
    assert.equal(parsePort('65535'), 65_535);
  });

  test('rejects missing, non-integer, and out-of-range values', () => {
    assert.equal(parsePort(undefined), undefined);
    assert.equal(parsePort(''), undefined);
    assert.equal(parsePort('0'), undefined);
    assert.equal(parsePort('12.5'), undefined);
    assert.equal(parsePort('65536'), undefined);
    assert.equal(parsePort('abc'), undefined);
  });
});

describe('parseBasePort', () => {
  test('keeps the base port low enough for every service offset', () => {
    assert.equal(parseBasePort('65523'), 65_523);
    assert.equal(parseBasePort('65524'), undefined);
  });
});

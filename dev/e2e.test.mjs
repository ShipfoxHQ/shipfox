import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {copyPlaywrightTestResults, defaultLogDir, e2eEnv, parseArgs} from './e2e.mjs';

const unknownCommandPattern = /Unknown command/;

describe('parseArgs', () => {
  test('defaults to running all E2E tests', () => {
    const options = parseArgs([]);

    assert.equal(options.turboTask, 'test:e2e');
    assert.deepEqual(options.turboArgs, []);
    assert.equal(options.keepOpen, false);
  });

  test('passes turbo filter arguments through', () => {
    const options = parseArgs(['run', '--filter=@shipfox/e2e-platform-workflows']);

    assert.deepEqual(options.turboArgs, ['--filter=@shipfox/e2e-platform-workflows']);
  });

  test('parses harness options before turbo args', () => {
    const options = parseArgs([
      'run',
      '--keep-open',
      '--log-dir=.context/e2e',
      '--timeout-ms',
      '120000',
      '--',
      '--filter=@shipfox/e2e-client-auth',
    ]);

    assert.equal(options.keepOpen, true);
    assert.equal(options.logDir, '.context/e2e');
    assert.equal(options.readinessTimeoutMs, 120_000);
    assert.deepEqual(options.turboArgs, ['--filter=@shipfox/e2e-client-auth']);
  });

  test('rejects unknown commands', () => {
    assert.throws(() => parseArgs(['down']), unknownCommandPattern);
  });
});

describe('e2eEnv', () => {
  test('uses worktree local-service URLs when present', () => {
    const env = e2eEnv({
      SHIPFOX_API_URL: 'http://localhost:55351',
      CLIENT_BASE_URL: 'http://localhost:55350',
      GITEA_BASE_URL: 'http://localhost:55356',
    });

    assert.equal(env.API_URL, 'http://localhost:55351');
    assert.equal(env.CLIENT_BASE_URL, 'http://localhost:55350');
    assert.equal(env.CLIENT_URL, 'http://localhost:55350');
    assert.equal(env.E2E_GITEA_URL, 'http://localhost:55356');
    assert.equal(env.GITEA_CLONE_BASE_URL, 'http://localhost:55356');
    assert.equal(env.VITE_API_URL, 'http://localhost:55351');
  });

  test('keeps explicit CI URLs over local-service defaults', () => {
    const env = e2eEnv({
      API_URL: 'http://localhost:16101',
      CLIENT_URL: 'http://localhost:5173',
      E2E_GITEA_URL: 'http://localhost:3001',
      GITEA_CLONE_BASE_URL: 'http://localhost:3000',
      SHIPFOX_API_URL: 'http://localhost:55351',
      GITEA_BASE_URL: 'http://localhost:55356',
    });

    assert.equal(env.API_URL, 'http://localhost:16101');
    assert.equal(env.CLIENT_URL, 'http://localhost:5173');
    assert.equal(env.E2E_GITEA_URL, 'http://localhost:3001');
    assert.equal(env.GITEA_CLONE_BASE_URL, 'http://localhost:3000');
  });
});

describe('defaultLogDir', () => {
  test('uses GitHub runner temp when available', () => {
    assert.equal(defaultLogDir({RUNNER_TEMP: '/tmp/gha'}), '/tmp/gha/shipfox-e2e-logs');
  });

  test('falls back to .context locally', () => {
    assert.equal(defaultLogDir({}), '.context/shipfox-e2e-logs');
  });
});

describe('copyPlaywrightTestResults', () => {
  test('stages only Playwright package test results', async () => {
    const originalCwd = process.cwd();
    const workspaceDir = await mkdtemp(join(tmpdir(), 'shipfox-e2e-workspace-'));
    const logDir = join(workspaceDir, 'logs');
    try {
      process.chdir(workspaceDir);
      await mkdir('e2e/api/auth/test-results/auth-flow', {recursive: true});
      await mkdir('e2e/client/workspaces/test-results/workspace-flow', {recursive: true});
      await mkdir('e2e/platform/workflows/test-results/scenario', {recursive: true});
      await mkdir('e2e/helpers/auth/test-results/helper-flow', {recursive: true});
      await writeFile('e2e/api/auth/test-results/auth-flow/trace.zip', 'api trace');
      await writeFile(
        'e2e/client/workspaces/test-results/workspace-flow/trace.zip',
        'client trace',
      );
      await writeFile('e2e/platform/workflows/test-results/scenario/trace.zip', 'platform trace');
      await writeFile('e2e/helpers/auth/test-results/helper-flow/trace.zip', 'helper trace');

      await copyPlaywrightTestResults(logDir);

      assert.equal(
        await readFile(
          join(
            logDir,
            'playwright-test-results/e2e/client/workspaces/test-results/workspace-flow/trace.zip',
          ),
          'utf8',
        ),
        'client trace',
      );
      await assert.rejects(
        readFile(
          join(
            logDir,
            'playwright-test-results/e2e/helpers/auth/test-results/helper-flow/trace.zip',
          ),
          'utf8',
        ),
        {code: 'ENOENT'},
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspaceDir, {recursive: true, force: true});
    }
  });
});

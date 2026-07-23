import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageDirectory, '../../..');
const biomeCheck = resolve(workspaceRoot, 'tools/biome/bin/biome-check.js');
const fixtureConfig = resolve(
  workspaceRoot,
  'tools/biome/plugins/client-architecture/fixtures/biome.fixture.json',
);
const fixtureRoot = resolve(
  workspaceRoot,
  'tools/biome/plugins/client-architecture/fixtures/fixture-boundary',
);
const diagnosticRulePattern = /client-architecture\/fixture-boundary/u;
const replacementBoundaryPattern = /approved feature-owned adapter or coordinator boundary/u;
const rejectedLocationPattern = /rejected\.ts:3/u;
const testFixturePattern = /ignored\.test\.ts/u;
const generatedFixturePattern = /rejected\.gen\.ts/u;

describe('client-architecture Biome plugins', () => {
  test('fails a rejected fixture through the package check wrapper', async () => {
    await assert.rejects(
      execFileAsync(process.execPath, [biomeCheck, '--config-path', fixtureConfig, fixtureRoot], {
        cwd: workspaceRoot,
      }),
      (error: unknown) => {
        const commandError = error as {stdout?: string; stderr?: string};
        const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
        assert.match(output, diagnosticRulePattern);
        assert.match(output, replacementBoundaryPattern);
        assert.match(output, rejectedLocationPattern);
        assert.doesNotMatch(output, testFixturePattern);
        assert.doesNotMatch(output, generatedFixturePattern);
        return true;
      },
    );
  });

  test('passes an allowed fixture through the package check wrapper', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [biomeCheck, '--config-path', fixtureConfig, resolve(fixtureRoot, 'allowed.ts')],
      {cwd: workspaceRoot},
    );

    assert.doesNotMatch(`${stdout}${stderr}`, diagnosticRulePattern);
  });
});

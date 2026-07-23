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
const fixtureRoot = resolve(workspaceRoot, 'tools/biome/plugins/client-architecture/fixtures');
const rejectedLocationPattern = /rejected\.ts:3/u;
const testFixturePattern = /ignored\.test\.ts/u;
const storyFixturePattern = /ignored\.stories\.ts/u;
const generatedFixturePattern = /rejected\.gen\.ts/u;

const fixtureRuleNames = [
  'fixture-boundary',
  'no-api-dto-in-core',
  'no-client-framework-in-core',
  'no-response-dto-in-presentation',
  'no-raw-api-request',
  'no-query-cache-ownership',
] as const;

describe('client-architecture Biome plugins', () => {
  for (const ruleName of fixtureRuleNames) {
    const ruleRoot = resolve(fixtureRoot, ruleName);

    test(`${ruleName} fails a rejected fixture through the package check wrapper`, async () => {
      await assert.rejects(
        execFileAsync(process.execPath, [biomeCheck, '--config-path', fixtureConfig, ruleRoot], {
          cwd: workspaceRoot,
        }),
        (error: unknown) => {
          const commandError = error as {stdout?: string; stderr?: string};
          const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
          assert.match(output, new RegExp(`client-architecture/${ruleName}`, 'u'));
          assert.match(output, rejectedLocationPattern);
          assert.doesNotMatch(output, testFixturePattern);
          assert.doesNotMatch(output, storyFixturePattern);
          assert.doesNotMatch(output, generatedFixturePattern);
          return true;
        },
      );
    });

    test(`${ruleName} passes an allowed fixture through the package check wrapper`, async () => {
      const {stdout, stderr} = await execFileAsync(
        process.execPath,
        [biomeCheck, '--config-path', fixtureConfig, resolve(fixtureRoot, ruleName, 'allowed.ts')],
        {cwd: workspaceRoot},
      );

      assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(`client-architecture/${ruleName}`, 'u'));
    });
  }
});

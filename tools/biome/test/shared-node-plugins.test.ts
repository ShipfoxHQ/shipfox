import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {removeStaleRootConfigProbes, withRootConfigProbe} from './root-config-probes.js';

const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageDirectory, '../../..');
const biomeCheck = resolve(workspaceRoot, 'tools/biome/bin/biome-check.js');
const fixtureConfig = resolve(
  workspaceRoot,
  'tools/biome/plugins/shared-node/fixtures/biome.fixture.json',
);
const fixtureRoot = resolve(
  workspaceRoot,
  'tools/biome/plugins/shared-node/fixtures/no-module-state',
);
const diagnosticPattern = /shared-node\/no-module-state/u;
const rejectedLocations = [
  'rejected.ts:1:1',
  'rejected.ts:2:8',
  'rejected.ts:3:1',
  'rejected.ts:4:7',
  'rejected.ts:5:7',
  'rejected.ts:6:7',
];

function commandOutput(error: unknown): string {
  const commandError = error as {stdout?: string; stderr?: string};
  return `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
}

describe('shared-node Biome plugins', () => {
  beforeAll(removeStaleRootConfigProbes);

  test('rejects module-level let, var, and written collections', async () => {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [biomeCheck, '--config-path', fixtureConfig, resolve(fixtureRoot, 'rejected.ts')],
        {cwd: workspaceRoot},
      ),
      (error: unknown) => {
        const output = commandOutput(error);
        for (const location of rejectedLocations) {
          assert.match(output, new RegExp(`${location.replaceAll('.', '\\.')} plugin`, 'u'));
        }
        assert.equal(output.match(/ plugin /gu)?.length, rejectedLocations.length);
        return true;
      },
    );
  });

  test('allows processState slots, constants, and local state', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [biomeCheck, '--config-path', fixtureConfig, resolve(fixtureRoot, 'allowed.ts')],
      {cwd: workspaceRoot},
    );

    assert.doesNotMatch(`${stdout}${stderr}`, diagnosticPattern);
  });

  test('enforces the rule on shared node package sources through the real root config', async () => {
    await withRootConfigProbe(
      'libs/shared/node/example/src/state.ts',
      [
        'let client: object | undefined;',
        '',
        'export function getClient(): object {',
        '  client ??= {};',
        '  return client;',
        '}',
        '',
      ].join('\n'),
      async (probePath) => {
        await assert.rejects(
          execFileAsync(process.execPath, [biomeCheck, probePath], {cwd: workspaceRoot}),
          (error: unknown) => {
            assert.match(commandOutput(error), diagnosticPattern);
            return true;
          },
        );
      },
    );
  });
});

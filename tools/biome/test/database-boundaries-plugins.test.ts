import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageDirectory, '../../..');
const diagnosticPattern = /database-boundaries\/no-direct-table-declaration/u;
const rejectedLocationPattern = /rejected\.ts:3/u;
const namespaceRejectedLocationPattern = /namespace-rejected\.ts:2/u;
const fixtureRulePattern = /database-boundaries\//u;
const biomeCheck = resolve(workspaceRoot, 'tools/biome/bin/biome-check.js');
const fixtureConfig = resolve(
  workspaceRoot,
  'tools/biome/plugins/database-boundaries/fixtures/biome.fixture.json',
);
const fixtureRoot = resolve(workspaceRoot, 'tools/biome/plugins/database-boundaries/fixtures');

describe('database-boundaries Biome plugin', () => {
  test('rejects direct Drizzle table factories through the package check wrapper', async () => {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          biomeCheck,
          '--config-path',
          fixtureConfig,
          resolve(fixtureRoot, 'no-direct-table-declaration'),
        ],
        {cwd: workspaceRoot},
      ),
      (error: unknown) => {
        const commandError = error as {stdout?: string; stderr?: string};
        const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
        assert.match(output, diagnosticPattern);
        assert.match(output, rejectedLocationPattern);
        assert.match(output, namespaceRejectedLocationPattern);
        return true;
      },
    );
  });
  test('allows a table factory imported from the local schema boundary', async () => {
    const {stdout, stderr} = await execFileAsync(
      process.execPath,
      [
        biomeCheck,
        '--config-path',
        fixtureConfig,
        resolve(fixtureRoot, 'no-direct-table-declaration', 'allowed.ts'),
      ],
      {cwd: workspaceRoot},
    );
    assert.doesNotMatch(`${stdout}${stderr}`, fixtureRulePattern);
  });
});

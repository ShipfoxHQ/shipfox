import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageDirectory, '../../..');
const biomeCheck = resolve(workspaceRoot, 'tools/biome/bin/biome-check.js');
const fixtureConfig = resolve(
  workspaceRoot,
  'tools/biome/plugins/api-architecture/fixtures/biome.fixture.json',
);
const fixtureRoot = resolve(workspaceRoot, 'tools/biome/plugins/api-architecture/fixtures');

const pluginFixtures = [
  {
    approvedBoundaryPattern: /producer DTO \/inter-module subpath/u,
    rejectedLocations: [
      /src\/index\.ts:1:1/u,
      /src\/index\.ts:3:1/u,
      /src\/index\.ts:4:1/u,
      /src\/index\.ts:5:1/u,
      /src\/index\.ts:7:1/u,
      /src\/index\.ts:8:1/u,
      /src\/index\.ts:9:1/u,
      /src\/index\.ts:11:23/u,
      /src\/index\.ts:12:23/u,
    ],
    ruleName: 'no-dto-root-inter-module',
  },
  {
    approvedBoundaryPattern: /passive contract modules/u,
    rejectedLocations: [
      /src\/index\.ts:1:1/u,
      /src\/index\.ts:3:1/u,
      /src\/index\.ts:4:1/u,
      /src\/index\.ts:5:1/u,
      /src\/index\.ts:7:1/u,
      /src\/index\.ts:8:1/u,
      /src\/index\.ts:9:1/u,
      /src\/index\.ts:11:23/u,
      /src\/index\.ts:12:18/u,
    ],
    ruleName: 'no-dto-root-implementation-detail',
  },
  {
    approvedBoundaryPattern: /implementation or composition packages/u,
    rejectedLocations: [
      /src\/rejected\.ts:1:1/u,
      /src\/rejected\.ts:3:1/u,
      /src\/rejected\.ts:4:1/u,
      /src\/rejected\.ts:5:1/u,
      /src\/rejected\.ts:7:23/u,
      /src\/rejected\.ts:8:23/u,
      /src\/rejected\.test\.ts:1:1/u,
      /test\/rejected\.ts:1:1/u,
      /test\/rejected\.ts:2:1/u,
      /test\/rejected\.ts:3:1/u,
      /test\/setup\.ts:1:1/u,
      /tests\/rejected\.ts:1:1/u,
    ],
    ruleName: 'no-dto-inter-module-import',
  },
] as const;

describe('api-architecture Biome plugins', () => {
  for (const fixture of pluginFixtures) {
    const ruleRoot = resolve(fixtureRoot, fixture.ruleName);

    test(`${fixture.ruleName} reports each rejected source expression`, async () => {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [biomeCheck, '--config-path', fixtureConfig, resolve(ruleRoot, 'rejected')],
          {cwd: workspaceRoot},
        ),
        (error: unknown) => {
          const commandError = error as {stdout?: string; stderr?: string};
          const output = `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`;
          const rulePattern = new RegExp(`api-architecture/${fixture.ruleName}`, 'gu');

          assert.equal(output.match(rulePattern)?.length, fixture.rejectedLocations.length);
          assert.match(output, fixture.approvedBoundaryPattern);
          for (const location of fixture.rejectedLocations) assert.match(output, location);
          return true;
        },
      );
    });

    test(`${fixture.ruleName} accepts equivalent passive-contract expressions`, async () => {
      const {stdout, stderr} = await execFileAsync(
        process.execPath,
        [biomeCheck, '--config-path', fixtureConfig, resolve(ruleRoot, 'allowed')],
        {cwd: workspaceRoot},
      );

      assert.doesNotMatch(
        `${stdout}${stderr}`,
        new RegExp(`api-architecture/${fixture.ruleName}`, 'u'),
      );
    });
  }

  test('registers production rules without excluding tests or setup files', async () => {
    const rootConfig = JSON.parse(await readFile(resolve(workspaceRoot, 'biome.json'), 'utf8')) as {
      plugins: {includes: string[]; path: string}[];
    };
    const apiPlugins = rootConfig.plugins.filter(({path}) =>
      path.startsWith('./tools/biome/plugins/api-architecture/'),
    );

    assert.deepEqual(apiPlugins, [
      {
        path: './tools/biome/plugins/api-architecture/no-dto-root-inter-module.grit',
        includes: [
          '**/libs/api/**/*-dto/src/index.ts',
          '!**/dist/**',
          '!**/node_modules/**',
          '!**/coverage/**',
        ],
      },
      {
        path: './tools/biome/plugins/api-architecture/no-dto-root-implementation-detail.grit',
        includes: [
          '**/libs/api/**/*-dto/src/index.ts',
          '!**/dist/**',
          '!**/node_modules/**',
          '!**/coverage/**',
        ],
      },
      {
        path: './tools/biome/plugins/api-architecture/no-dto-inter-module-import.grit',
        includes: [
          '**/libs/api/**/*-dto/**',
          '!**/dist/**',
          '!**/node_modules/**',
          '!**/coverage/**',
        ],
      },
    ]);
  });
});

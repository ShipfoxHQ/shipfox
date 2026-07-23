import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const tarEntryLinePattern = /\r?\n/u;
const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, '..');
const PACKED_PACKAGE_TEST_TIMEOUT_MS = 30_000;
const fixtureTemplate = resolve(
  packageRoot,
  'plugins/client-architecture/fixtures/external-consumer',
);
const biomeBinary = resolve(packageRoot, 'node_modules/.bin/biome');
const publishedPluginFiles = [
  'plugins/client-architecture/no-api-dto-in-core.grit',
  'plugins/client-architecture/no-client-framework-in-core.grit',
  'plugins/client-architecture/no-query-cache-ownership.grit',
  'plugins/client-architecture/no-raw-api-request.grit',
  'plugins/client-architecture/no-response-dto-in-presentation.grit',
  'plugins/database-boundaries/no-direct-table-declaration.grit',
] as const;
const externalRuleFixtures = [
  {
    name: 'no-api-dto-in-core',
    allowed: 'libs/client/external/src/core/no-api-dto/allowed.ts',
    rejected: 'libs/client/external/src/core/no-api-dto/rejected.ts',
  },
  {
    name: 'no-client-framework-in-core',
    allowed: 'libs/client/external/src/core/no-client-framework/allowed.ts',
    rejected: 'libs/client/external/src/core/no-client-framework/rejected.ts',
  },
  {
    name: 'no-response-dto-in-presentation',
    allowed: 'libs/client/external/src/pages/no-response-dto/allowed.ts',
    rejected: 'libs/client/external/src/pages/no-response-dto/rejected.ts',
  },
  {
    name: 'no-raw-api-request',
    allowed: 'libs/client/external/src/components/no-raw-api-request/allowed.ts',
    rejected: 'libs/client/external/src/components/no-raw-api-request/rejected.ts',
  },
  {
    name: 'no-query-cache-ownership',
    allowed: 'libs/client/external/src/components/no-query-cache-ownership/allowed.ts',
    rejected: 'libs/client/external/src/components/no-query-cache-ownership/rejected.ts',
  },
] as const;
const excludedFixtureFiles = [
  'libs/client/external/src/core/test/rejected.ts',
  'libs/client/external/src/pages/ignored.stories.ts',
  'libs/client/external/src/core/generated/rejected.gen.ts',
  'libs/client/external/src/core/dist/rejected.ts',
  'node_modules/fixture/libs/client/external/src/core/rejected.ts',
] as const;

type CommandFailure = {
  code?: number | string;
  stderr?: string;
  stdout?: string;
};

async function packBiome(destination: string): Promise<string> {
  const {stdout} = await execFileAsync(
    'npm',
    ['pack', '--json', '--pack-destination', destination],
    {cwd: packageRoot},
  );
  const metadata = JSON.parse(stdout) as Array<{filename?: string}>;
  const filename = metadata[0]?.filename;
  assert.ok(filename, 'npm pack did not return a tarball filename');
  return join(destination, filename);
}

async function tarEntries(tarball: string): Promise<string[]> {
  const {stdout} = await execFileAsync('tar', ['-tzf', tarball]);
  return stdout.split(tarEntryLinePattern).filter(Boolean);
}

async function installPackedBiome(externalRoot: string, tarball: string): Promise<void> {
  const packageDirectory = join(externalRoot, 'node_modules/@shipfox/biome');
  await mkdir(packageDirectory, {recursive: true});
  await execFileAsync('tar', ['-xzf', tarball, '-C', packageDirectory, '--strip-components', '1']);
}

async function runBiome(
  externalRoot: string,
  target: string,
): Promise<{code: number; output: string}> {
  try {
    const {stdout, stderr} = await execFileAsync(
      biomeBinary,
      ['check', '--config-path', 'biome.json', target],
      {cwd: externalRoot},
    );
    return {code: 0, output: `${stdout}${stderr}`};
  } catch (error) {
    const failure = error as CommandFailure;
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('packed client-architecture Biome plugins', () => {
  test(
    'includes every supported plugin and its usage documentation',
    async () => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-biome-pack-'));
      try {
        const tarball = await packBiome(temporaryRoot);
        const entries = await tarEntries(tarball);
        for (const path of publishedPluginFiles) {
          assert.ok(entries.includes(`package/${path}`), `Packed artifact is missing ${path}`);
        }
        assert.ok(entries.includes('package/plugins/client-architecture/README.md'));
        assert.ok(entries.includes('package/plugins/database-boundaries/README.md'));
        assert.ok(
          !entries.some((entry) =>
            entry.startsWith('package/plugins/client-architecture/fixtures/'),
          ),
          'Packed artifact must not publish repository fixtures',
        );
      } finally {
        await rm(temporaryRoot, {force: true, recursive: true});
      }
    },
    PACKED_PACKAGE_TEST_TIMEOUT_MS,
  );

  test(
    'runs from an installed package in an external repository root',
    async () => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-biome-external-'));
      try {
        const tarball = await packBiome(temporaryRoot);
        const externalRoot = join(temporaryRoot, 'consumer');
        await cp(fixtureTemplate, externalRoot, {recursive: true});
        await installPackedBiome(externalRoot, tarball);

        const nodeModulesFixture = join(externalRoot, excludedFixtureFiles[4]);
        await mkdir(dirname(nodeModulesFixture), {recursive: true});
        await writeFile(
          nodeModulesFixture,
          "\n\nimport type {ProjectResponseDto as Project} from '@shipfox/api-projects-dto';\n\nexport type {Project};\n",
        );

        for (const fixture of externalRuleFixtures) {
          const allowed = await runBiome(externalRoot, fixture.allowed);
          assert.equal(
            allowed.code,
            0,
            `${fixture.name} allowed fixture failed:\n${allowed.output}`,
          );

          const rejected = await runBiome(externalRoot, fixture.rejected);
          assert.notEqual(rejected.code, 0, `${fixture.name} rejected fixture passed`);
          assert.match(rejected.output, new RegExp(`client-architecture/${fixture.name}`, 'u'));
          assert.match(rejected.output, new RegExp(`${escapedRegExp(fixture.rejected)}:3`, 'u'));
        }

        const fullFixture = await runBiome(externalRoot, '.');
        assert.notEqual(fullFixture.code, 0, 'The external rejected fixtures unexpectedly passed');
        for (const excludedPath of excludedFixtureFiles) {
          assert.doesNotMatch(
            fullFixture.output,
            new RegExp(escapedRegExp(excludedPath), 'u'),
            `Excluded fixture produced a diagnostic: ${excludedPath}`,
          );
        }
      } finally {
        await rm(temporaryRoot, {force: true, recursive: true});
      }
    },
    PACKED_PACKAGE_TEST_TIMEOUT_MS,
  );
});

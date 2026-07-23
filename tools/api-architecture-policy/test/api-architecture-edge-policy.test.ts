import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageDirectory, '../../..');
const fixtureRoot = resolve(workspaceRoot, 'fixtures/depcruise-api-edges');
const dependencyCruiserDirectory = resolve(
  workspaceRoot,
  'tools/depcruise/node_modules/dependency-cruiser',
);
const {main: dependencyCruiserMain} = require(
  resolve(dependencyCruiserDirectory, 'package.json'),
) as {main: string};
const dependencyCruiserModule = import(
  pathToFileURL(resolve(dependencyCruiserDirectory, dependencyCruiserMain)).href
) as Promise<{
  cruise: (
    files: string[],
    options: Record<string, unknown>,
  ) => Promise<{output: string | Record<string, unknown>}>;
}>;
const noDependencyViolationsPattern = /no dependency violations found/u;
const {createFixtureConfiguration} = require(resolve(fixtureRoot, 'fixture-config.cjs')) as {
  createFixtureConfiguration: (currentDirectory: string) => {
    forbidden: Array<Record<string, unknown>>;
    options: Record<string, unknown>;
  };
};
const {
  apiArchitectureEdgePolicy,
  architecturePackages,
  createApiArchitectureRules,
  validateApiArchitectureEdgePolicy,
} = require(resolve(workspaceRoot, 'api-contexts.cjs')) as {
  apiArchitectureEdgePolicy: Record<string, Record<string, {decision: string}>>;
  architecturePackages: Record<string, Record<string, string[]>>;
  createApiArchitectureRules: (options: {
    currentDirectory: string;
    workspaceRoot: string;
  }) => Array<{name: string}>;
  validateApiArchitectureEdgePolicy: (
    packages?: Record<string, Record<string, string[]>>,
    edgePolicy?: Record<string, Record<string, {decision: string}>>,
  ) => string[];
};

async function runFixture(fixtureName: string): Promise<string> {
  const fixturePackage = resolve(fixtureRoot, 'packages/consumers', fixtureName);
  const {options, ...ruleSet} = createFixtureConfiguration(fixturePackage);
  const {cruise} = await dependencyCruiserModule;
  const {output} = await cruise(['.'], {
    ...options,
    baseDir: fixturePackage,
    outputType: 'err',
    ruleSet,
    validate: true,
  });

  assert.ok(typeof output === 'string');
  return output;
}

describe('API Dependency Cruiser edge policy', () => {
  test('declares an explicit decision for every registered classification pair', () => {
    assert.deepEqual(validateApiArchitectureEdgePolicy(), []);

    const expandedPackages = {
      ...architecturePackages,
      experimental: {future: ['packages/future']},
    };
    const errors = validateApiArchitectureEdgePolicy(expandedPackages, apiArchitectureEdgePolicy);
    assert.deepEqual(errors, [
      'Missing API architecture edge policy decision: composition-root -> experimental',
      'Missing API architecture edge policy decision: dto -> experimental',
      'Missing API architecture edge policy decision: implementations -> experimental',
      'Missing API architecture edge policy decision: shared-infrastructure -> experimental',
      'Missing API architecture edge policy decision: shared-semantic -> experimental',
      'Missing API architecture edge policy decision: spi -> experimental',
      'Missing API architecture edge policy row: experimental',
    ]);
  });

  test('flags invalid decisions, incomplete violation metadata, and unknown classifications', () => {
    const packages = {a: {ctx: ['packages/a']}, b: {ctx: ['packages/b']}};
    const edgePolicy = {
      a: {a: {decision: 'allow'}, b: {decision: 'bogus', rule: 'x', violation: 'y'}},
      b: {a: {decision: 'never'}, b: {decision: 'allow'}, c: {decision: 'allow'}},
      c: {a: {decision: 'allow'}, b: {decision: 'allow'}},
    };

    assert.deepEqual(validateApiArchitectureEdgePolicy(packages, edgePolicy), [
      'API architecture edge policy has unknown row: c',
      'API architecture edge policy references unknown classification: b -> c',
      'API architecture edge policy violation metadata is incomplete: b -> a',
      'Invalid API architecture edge policy decision: a -> b',
    ]);
  });

  test('generates classification-aware rules for nested package paths', () => {
    const rules = createApiArchitectureRules({
      currentDirectory: resolve(workspaceRoot, 'libs/api/integration/core'),
      workspaceRoot,
    });

    assert.deepEqual(
      rules.map(({name}) => name),
      ['api-no-foreign-implementation-imports'],
    );
  });

  test('enforces every forbidden source-edge category across source variants and test roots', async () => {
    const cases = [
      [
        'implementation-foreign',
        ['api-no-foreign-implementation-imports', 'api-no-foreign-same-context-spi-imports'],
      ],
      ['dto-foreign', ['api-no-dto-implementation-imports', 'api-no-dto-spi-imports']],
      [
        'semantic-foreign',
        ['api-no-shared-semantic-implementation-imports', 'api-no-shared-semantic-spi-imports'],
      ],
      ['spi-foreign', ['api-no-foreign-spi-implementation-imports', 'api-no-foreign-spi-imports']],
    ] as const;

    for (const [fixtureName, ruleNames] of cases) {
      const output = await runFixture(fixtureName);
      for (const ruleName of ruleNames) assert.match(output, new RegExp(ruleName, 'u'));
      if (fixtureName === 'implementation-foreign') {
        for (const sourcePath of [
          'src/consumer.ts',
          'test/consumer.ts',
          'test/consumer.tsx',
          'tests/consumer.mts',
          'tests/consumer.jsx',
          'fixtures/consumer.cts',
          'fixtures/consumer.js',
          'setup/setup.mjs',
          'setup/consumer.cjs',
          'vitest.config.mts',
        ]) {
          assert.ok(output.includes(sourcePath), `Dependency Cruiser did not report ${sourcePath}`);
        }
      }
    }
  });

  test('preserves same-context Integrations implementation and SPI edges', async () => {
    const output = await runFixture('implementation-allowed');
    assert.match(output, noDependencyViolationsPattern);

    const spiOutput = await runFixture('spi-allowed');
    assert.match(spiOutput, noDependencyViolationsPattern);
  });
});

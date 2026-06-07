import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

type DependencyCruiserRule = {
  readonly name: string;
  readonly from: {
    readonly path: string;
  };
  readonly to: {
    readonly path: string;
    readonly pathNot?: string;
  };
};

type DependencyCruiserConfig = {
  readonly forbidden: readonly DependencyCruiserRule[];
};

function loadConfig(packageName: string): DependencyCruiserConfig {
  const configPath = require.resolve('../../../../.dependency-cruiser.cjs');
  const previousPackageName = process.env.SHIPFOX_DEPCRUISE_PACKAGE_NAME;

  process.env.SHIPFOX_DEPCRUISE_PACKAGE_NAME = packageName;
  delete require.cache[configPath];

  try {
    return require(configPath) as DependencyCruiserConfig;
  } finally {
    if (previousPackageName === undefined) {
      delete process.env.SHIPFOX_DEPCRUISE_PACKAGE_NAME;
    } else {
      process.env.SHIPFOX_DEPCRUISE_PACKAGE_NAME = previousPackageName;
    }
    delete require.cache[configPath];
  }
}

function findWorkflowLanguageRule(
  config: DependencyCruiserConfig,
): DependencyCruiserRule | undefined {
  return config.forbidden.find(
    (candidate) => candidate.name === 'workflow-language-no-feature-runtime-dependencies',
  );
}

function isForbiddenBy(rule: DependencyCruiserRule, fromPath: string, toPath: string): boolean {
  const matchesFrom = new RegExp(rule.from.path).test(fromPath);
  const matchesTo = new RegExp(rule.to.path).test(toPath);
  const excludedTo =
    rule.to.pathNot === undefined ? false : new RegExp(rule.to.pathNot).test(toPath);

  return matchesFrom && matchesTo && !excludedTo;
}

function isForbiddenByConfig(
  config: DependencyCruiserConfig,
  fromPath: string,
  toPath: string,
): boolean {
  return config.forbidden.some((rule) => isForbiddenBy(rule, fromPath, toPath));
}

describe('workflow-language dependency boundary', () => {
  test('forbids workflow-language feature and runtime dependencies', () => {
    const config = loadConfig('@shipfox/api-workflow-language');
    const rule = findWorkflowLanguageRule(config);

    expect(rule).toBeDefined();
    expect(rule?.from.path).toBe('^(src|test|scripts)/');

    expect(
      isForbiddenBy(rule as DependencyCruiserRule, 'src/index.ts', '../workflows/src/index.ts'),
    ).toBe(true);
    expect(
      isForbiddenBy(rule as DependencyCruiserRule, 'src/index.ts', '../definitions/src/index.ts'),
    ).toBe(true);
    expect(
      isForbiddenBy(
        rule as DependencyCruiserRule,
        'scripts/generate-formalization-docs.ts',
        '../triggers/src/index.ts',
      ),
    ).toBe(true);
    expect(
      isForbiddenBy(
        rule as DependencyCruiserRule,
        'test/example.test.ts',
        '../runners/src/index.ts',
      ),
    ).toBe(true);
    expect(
      isForbiddenBy(
        rule as DependencyCruiserRule,
        'src/index.ts',
        '../../client/runners/src/index.ts',
      ),
    ).toBe(true);
    expect(
      isForbiddenBy(
        rule as DependencyCruiserRule,
        'src/index.ts',
        '../../../apps/api/src/index.ts',
      ),
    ).toBe(true);
    expect(
      isForbiddenBy(
        rule as DependencyCruiserRule,
        'src/index.ts',
        '../../shared/node/drizzle/src/index.ts',
      ),
    ).toBe(true);
    expect(
      isForbiddenBy(
        rule as DependencyCruiserRule,
        'src/index.ts',
        'node_modules/fastify/fastify.js',
      ),
    ).toBe(true);
    expect(
      isForbiddenBy(
        rule as DependencyCruiserRule,
        'src/index.ts',
        'node_modules/@temporalio/workflow/lib/index.js',
      ),
    ).toBe(true);
  });

  test('does not apply workflow-language-only constraints to feature packages', () => {
    const workflowsConfig = loadConfig('@shipfox/api-workflows');
    const definitionsConfig = loadConfig('@shipfox/api-definitions');

    expect(findWorkflowLanguageRule(workflowsConfig)).toBeUndefined();
    expect(findWorkflowLanguageRule(definitionsConfig)).toBeUndefined();
    expect(
      isForbiddenByConfig(workflowsConfig, 'src/index.ts', '../definitions-dto/src/index.ts'),
    ).toBe(false);
    expect(
      isForbiddenByConfig(definitionsConfig, 'src/index.ts', '../definitions-dto/src/index.ts'),
    ).toBe(false);
  });
});

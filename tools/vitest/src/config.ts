import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getProjectRootPath, getWorkspaceRootPath} from '@shipfox/tool-utils';
import {
  type TestProjectConfiguration,
  type UserWorkspaceConfig,
  defineConfig as vitestDefineConfig,
  defineProject as vitestDefineProject,
} from 'vitest/config';

export type {
  TestProjectConfiguration,
  UserWorkspaceConfig,
} from 'vitest/config';

export type UserConfigExport = ReturnType<typeof vitestDefineConfig>;
export type UserConfigFnObject = () => Parameters<typeof vitestDefineConfig>[0];

export type UserConfig = Parameters<typeof vitestDefineConfig>[0];

type ConfigInput = UserConfig | UserWorkspaceConfig;
type MergeableConfigInput = ConfigInput & {
  plugins?: unknown[];
  resolve?: {
    alias?: ResolveAlias;
    conditions?: string[];
    externalConditions?: string[];
    external?: string[] | true;
  };
  ssr?: {
    external?: string[] | true;
    resolve?: {
      conditions?: string[];
      externalConditions?: string[];
    };
  };
  optimizeDeps?: {
    rolldownOptions?: {
      checks?: Record<string, unknown>;
    };
  };
  test?: {
    deps?: {
      optimizer?: Record<
        string,
        {
          enabled?: boolean;
          include?: string[];
        }
      >;
    };
    exclude?: string[];
    server?: {
      deps?: {
        external?: (string | RegExp)[];
        inline?: (string | RegExp)[] | true;
        fallbackCJS?: boolean;
      };
      debug?: unknown;
    };
  };
};

const workspacePackagePattern = /^@shipfox\/.+/;
const workspaceDistFilePattern = /\/(?:apps|e2e|infra|libs|tools|turbo)\/.*\/dist\/.*\.m?js$/;
const clientDistConditions = ['module', 'browser'];
const serverDistConditions = ['node'];
const serverModuleDistConditions = ['module', 'node'];
const externalDistConditions = ['node', 'module-sync'];
const workspacePackageRoots = ['apps', 'e2e', 'libs', 'tools', 'infra', 'turbo'];
const projectRootSlashImportPattern = /^#\/(.+)$/;
const projectRootImportPattern = /^#(?!test\/)(.+)$/;
const esmOptimizerPackages = [
  {dependencyName: '@opentelemetry/api', optimizerName: '@opentelemetry/api'},
  {dependencyName: '@opentelemetry/core', optimizerName: '@opentelemetry/core'},
];
const esmOptimizerInlinePattern = /@opentelemetry\/(?:api|core)/;
let cachedWorkspacePackageNames: string[] | undefined;

type ResolveAlias = Array<{find: string | RegExp; replacement: string}> | Record<string, string>;
type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type EnvironmentConfig = {
  resolve?: {
    alias?: ResolveAlias;
    conditions?: string[];
    externalConditions?: string[];
    external?: string[] | true;
  };
};

function parseMaxWorkers(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const maxWorkers = Number(value);
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    throw new Error(`SHIPFOX_VITEST_MAX_WORKERS must be a positive integer, got "${value}".`);
  }

  return maxWorkers;
}

function createWorkerPoolConfig(): {maxWorkers?: number} {
  const maxWorkers = parseMaxWorkers(process.env.SHIPFOX_VITEST_MAX_WORKERS);
  return maxWorkers === undefined ? {} : {maxWorkers};
}

function withoutConditions(conditions: string[], excludedConditions: string[]): string[] {
  return conditions.filter(
    (condition) =>
      condition !== 'development' &&
      condition !== 'development|production' &&
      !excludedConditions.includes(condition),
  );
}

function mergeConditions(
  existing: string[] | undefined,
  fallback: string[],
  excludedConditions: string[] = [],
): string[] {
  return Array.from(
    new Set([
      ...withoutConditions(existing ?? [], excludedConditions),
      ...withoutConditions(fallback, excludedConditions),
    ]),
  );
}

function mergeExternalPackages(existing: string[] | true | undefined, packageNames: string[]) {
  if (existing === true) return true;
  return Array.from(new Set([...(existing || []), ...packageNames]));
}

function mergeInlineDeps(
  existing: (string | RegExp)[] | true | undefined,
  deps: Array<string | RegExp>,
) {
  if (existing === true) return true;
  return [...(existing || []), ...deps];
}

function mergeStringList(existing: string[] | undefined, values: string[]): string[] {
  return Array.from(new Set([...(existing || []), ...values]));
}

function getDirectDependencyNames(projectRoot: string | undefined): Set<string> {
  if (!projectRoot) return new Set();

  const packageJsonPath = join(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) return new Set();

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;
  return new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ]);
}

function getResolvableEsmOptimizerPackageNames(projectRoot: string | undefined): string[] {
  const directDependencyNames = getDirectDependencyNames(projectRoot);
  return esmOptimizerPackages.flatMap(({dependencyName, optimizerName}) =>
    directDependencyNames.has(dependencyName) ? [optimizerName] : [],
  );
}

function getServerExcludedConditions(projectRoot: string | undefined): string[] {
  const directDependencyNames = getDirectDependencyNames(projectRoot);
  return directDependencyNames.has('@opentelemetry/api') ||
    directDependencyNames.has('@opentelemetry/core')
    ? []
    : ['module'];
}

function getServerFallbackConditions(serverExcludedConditions: string[]): string[] {
  return serverExcludedConditions.includes('module')
    ? serverDistConditions
    : serverModuleDistConditions;
}

function mergeServerConditions(
  conditions: string[] | undefined,
  fallbackConditions: string[],
  excludedConditions: string[],
): string[] {
  return mergeConditions(conditions, fallbackConditions, excludedConditions);
}

function normalizeAlias(alias: ResolveAlias | undefined): Array<{
  find: string | RegExp;
  replacement: string;
}> {
  if (!alias) return [];
  if (Array.isArray(alias)) return alias;
  return Object.entries(alias).map(([find, replacement]) => ({find, replacement}));
}

function mergeProjectSourceAliases(
  alias: ResolveAlias | undefined,
  projectRoot: string | undefined,
) {
  const existingAliases = normalizeAlias(alias);
  if (!projectRoot) return existingAliases;

  const projectSrc = join(projectRoot, 'src');
  return [
    {find: projectRootSlashImportPattern, replacement: `${projectSrc}/$1`},
    {find: projectRootImportPattern, replacement: `${projectSrc}/$1`},
    ...existingAliases,
  ];
}

function collectWorkspacePackageNames(dir: string, names: Set<string>): void {
  const packageJsonPath = join(dir, 'package.json');
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {name?: string};
    if (packageJson.name?.startsWith('@shipfox/')) names.add(packageJson.name);
    return;
  }

  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    collectWorkspacePackageNames(join(dir, entry.name), names);
  }
}

function getWorkspacePackageNames(): string[] {
  if (cachedWorkspacePackageNames) return cachedWorkspacePackageNames;

  const names = new Set<string>();
  const workspaceRoot = getWorkspaceRootPath();
  for (const packageRoot of workspacePackageRoots) {
    collectWorkspacePackageNames(join(workspaceRoot, packageRoot), names);
  }

  cachedWorkspacePackageNames = Array.from(names).sort();
  return cachedWorkspacePackageNames;
}

function createWorkspaceDistResolutionPlugin(
  packageNames: string[],
  projectRoot: string | undefined,
  serverExcludedConditions: string[],
) {
  return {
    name: 'shipfox-vitest-workspace-dist-resolution',
    configEnvironment(name: string, environmentConfig: EnvironmentConfig) {
      const resolveConfig = environmentConfig.resolve || {};
      const fallbackConditions =
        name === 'client'
          ? clientDistConditions
          : getServerFallbackConditions(serverExcludedConditions);

      environmentConfig.resolve = {
        ...resolveConfig,
        alias: mergeProjectSourceAliases(resolveConfig.alias, projectRoot),
        conditions:
          name === 'client'
            ? mergeConditions(resolveConfig.conditions, fallbackConditions)
            : mergeServerConditions(
                resolveConfig.conditions,
                fallbackConditions,
                serverExcludedConditions,
              ),
        externalConditions: mergeConditions(
          resolveConfig.externalConditions,
          externalDistConditions,
        ),
        external: mergeExternalPackages(resolveConfig.external, packageNames),
      };
    },
  };
}

function createMergedConfig(resolvedConfig: ConfigInput, projectRoot?: string): ConfigInput {
  const mergeableConfig = resolvedConfig as MergeableConfigInput;
  const useBuiltWorkspaceDeps = process.env.CI === 'true';
  const workerPoolConfig = createWorkerPoolConfig();
  const workspacePackageNames = useBuiltWorkspaceDeps ? getWorkspacePackageNames() : [];
  const esmOptimizerIncludes = useBuiltWorkspaceDeps
    ? getResolvableEsmOptimizerPackageNames(projectRoot)
    : [];
  const serverExcludedConditions = useBuiltWorkspaceDeps
    ? getServerExcludedConditions(projectRoot)
    : [];
  const serverFallbackConditions = getServerFallbackConditions(serverExcludedConditions);
  const existingPlugins = mergeableConfig.plugins || [];
  const workspaceDistPlugin = useBuiltWorkspaceDeps
    ? [
        createWorkspaceDistResolutionPlugin(
          workspacePackageNames,
          projectRoot,
          serverExcludedConditions,
        ),
      ]
    : [];
  const resolveConfig = mergeableConfig.resolve || {};
  const ssrConfig = mergeableConfig.ssr || {};
  const ssrResolveConfig = ssrConfig.resolve || {};
  const testConfig = mergeableConfig.test || {};
  const testDepsConfig = testConfig.deps || {};
  const testDepsOptimizerConfig = testDepsConfig.optimizer || {};
  const testDepsSsrOptimizerConfig = testDepsOptimizerConfig.ssr || {};
  const testServerConfig = testConfig.server || {};
  const testServerDepsConfig = testServerConfig.deps || {};
  const workspaceDistConfig = useBuiltWorkspaceDeps
    ? {
        resolve: {
          ...resolveConfig,
          alias: mergeProjectSourceAliases(resolveConfig.alias, projectRoot),
          conditions: mergeConditions(resolveConfig.conditions, clientDistConditions),
          externalConditions: mergeConditions(
            resolveConfig.externalConditions,
            externalDistConditions,
          ),
          external: mergeExternalPackages(resolveConfig.external, workspacePackageNames),
        },
        ssr: {
          ...ssrConfig,
          external: mergeExternalPackages(ssrConfig.external, workspacePackageNames),
          resolve: {
            ...ssrResolveConfig,
            conditions: mergeServerConditions(
              ssrResolveConfig.conditions,
              serverFallbackConditions,
              serverExcludedConditions,
            ),
            externalConditions: mergeConditions(
              ssrResolveConfig.externalConditions,
              externalDistConditions,
            ),
          },
        },
      }
    : {};
  const merged = {
    ...resolvedConfig,
    plugins: [...existingPlugins, ...workspaceDistPlugin],
    ...workspaceDistConfig,
    optimizeDeps: {
      ...(mergeableConfig.optimizeDeps || {}),
      rolldownOptions: {
        ...(mergeableConfig.optimizeDeps?.rolldownOptions || {}),
        checks: {
          ...(mergeableConfig.optimizeDeps?.rolldownOptions?.checks || {}),
          pluginTimings: false,
        },
      },
    },
    test: {
      ...testConfig,
      globals: true,
      ...workerPoolConfig,
      ...(useBuiltWorkspaceDeps
        ? {
            deps: {
              ...testDepsConfig,
              optimizer: {
                ...testDepsOptimizerConfig,
                ssr: {
                  ...testDepsSsrOptimizerConfig,
                  enabled: true,
                  include: mergeStringList(
                    testDepsSsrOptimizerConfig.include,
                    esmOptimizerIncludes,
                  ),
                },
              },
            },
            server: {
              ...testServerConfig,
              deps: {
                ...testServerDepsConfig,
                external: [
                  ...(testServerDepsConfig.external || []),
                  workspacePackagePattern,
                  workspaceDistFilePattern,
                ],
                inline: mergeInlineDeps(testServerDepsConfig.inline, [
                  esmOptimizerInlinePattern,
                ]),
              },
            },
          }
        : {}),
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/out/**',
        ...(mergeableConfig.test?.exclude || []),
      ],
    },
  };

  if (projectRoot && !(merged as {root?: string}).root) {
    (merged as {root: string}).root = projectRoot;
  }

  return merged as ConfigInput;
}

function mergeConfig(config: ConfigInput, callerUrl?: string): ConfigInput {
  const projectRoot = callerUrl ? getProjectRootPath(callerUrl) : undefined;

  if (typeof config === 'function') {
    return ((env) => {
      const resolved = config(env);
      if (resolved instanceof Promise) {
        return resolved.then((resolvedConfig) => createMergedConfig(resolvedConfig, projectRoot));
      }
      return createMergedConfig(resolved, projectRoot);
    }) as typeof config;
  }

  return createMergedConfig(config, projectRoot);
}

export function defineConfig(config: UserConfig, callerUrl?: string): UserConfigExport {
  return vitestDefineConfig(mergeConfig(config, callerUrl) as UserConfig);
}

export function defineProject(
  configOrFn: UserWorkspaceConfig,
  callerUrl: string,
): TestProjectConfiguration {
  return vitestDefineProject(mergeConfig(configOrFn, callerUrl) as UserWorkspaceConfig);
}

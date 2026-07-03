import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {getWorkspaceRootPath} from '@shipfox/tool-utils';
import {
  mergeConditions,
  mergeExternalPackages,
  mergeInlineDeps,
  mergeProjectSourceAliases,
  mergeStringList,
} from './config-merge.js';
import type {
  EnvironmentConfig,
  MergeableConfigFragment,
  MergeableConfigInput,
  PackageJson,
} from './config-types.js';

const workspacePackagePattern = /^@shipfox\/.+/;
const workspaceDistFilePattern = /\/(?:apps|e2e|infra|libs|tools|turbo)\/.*\/dist\/.*\.m?js$/;
const workspaceDistInternalImportPattern = /^#\/?(.+)$/;
const workspaceDistInternalImportSpecifierPattern = /(['"])#\/?([^'"]+)\1/g;
const viteFsPrefix = '/@fs';
const clientDistConditions = ['module', 'browser'];
const serverDistConditions = ['node'];
const serverModuleDistConditions = ['module', 'node'];
const externalDistConditions = ['node', 'module-sync'];
const workspacePackageRoots = ['apps', 'e2e', 'libs', 'tools', 'infra', 'turbo'];
const esmOptimizerPackages = [
  {dependencyName: '@opentelemetry/api', optimizerName: '@opentelemetry/api'},
  {dependencyName: '@opentelemetry/core', optimizerName: '@opentelemetry/core'},
];
const esmOptimizerInlinePattern = /@opentelemetry\/(?:api|core)/;
let cachedWorkspacePackageNames: string[] | undefined;

type WorkspaceDistInternalImportResolverPlugin = {
  name: string;
  enforce: 'pre';
  resolveId(source: string, importer?: string): string | undefined;
  transform(code: string, id: string): string | undefined;
};

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

function getResolvableEsmOptimizerPackageNames(directDependencyNames: Set<string>): string[] {
  if (!hasDirectOpenTelemetryEsmGraph(directDependencyNames)) return [];

  return esmOptimizerPackages.map(({optimizerName}) => optimizerName);
}

function getServerExcludedConditions(directDependencyNames: Set<string>): string[] {
  return hasDirectOpenTelemetryEsmGraph(directDependencyNames) ? [] : ['module'];
}

function hasDirectOpenTelemetryEsmGraph(directDependencyNames: Set<string>): boolean {
  return (
    directDependencyNames.has('@opentelemetry/api') &&
    directDependencyNames.has('@opentelemetry/core')
  );
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

function normalizeImporterPath(
  importer: string | undefined,
  projectRoot: string | undefined,
): string | undefined {
  const importerPath = importer?.split('?')[0];
  if (!importerPath) return undefined;

  const filePath = importerPath.startsWith(`${viteFsPrefix}/`)
    ? importerPath.slice(viteFsPrefix.length)
    : importerPath;

  return isAbsolute(filePath) || !projectRoot ? filePath : resolve(projectRoot, filePath);
}

function findWorkspacePackageRoot(filePath: string): string | undefined {
  const workspaceRoot = getWorkspaceRootPath();
  let currentDir = dirname(filePath);

  while (currentDir.startsWith(workspaceRoot)) {
    if (existsSync(join(currentDir, 'package.json'))) return currentDir;

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return undefined;
    currentDir = parentDir;
  }

  return undefined;
}

function resolveWorkspaceDistInternalImport(
  source: string,
  importer: string | undefined,
  projectRoot: string | undefined,
): string | undefined {
  if (source.startsWith('#test/')) return undefined;

  const sourceMatch = workspaceDistInternalImportPattern.exec(source);
  const importerPath = normalizeImporterPath(importer, projectRoot);
  if (!sourceMatch || !importerPath || !workspaceDistFilePattern.test(importerPath)) {
    return undefined;
  }

  const importPath = sourceMatch[1];
  if (!importPath) return undefined;

  const packageRoot = findWorkspacePackageRoot(importerPath);
  if (!packageRoot) return undefined;

  return join(packageRoot, 'dist', importPath);
}

function toRelativeImportPath(importerPath: string, resolvedPath: string): string {
  const importPath = relative(dirname(importerPath), resolvedPath).replaceAll('\\', '/');
  return importPath.startsWith('.') ? importPath : `./${importPath}`;
}

function rewriteWorkspaceDistInternalImports(
  code: string,
  id: string,
  projectRoot: string | undefined,
): string | undefined {
  const importerPath = normalizeImporterPath(id, projectRoot);
  if (!importerPath || !workspaceDistFilePattern.test(importerPath)) return undefined;

  let rewritten = false;
  const output = code.replace(
    workspaceDistInternalImportSpecifierPattern,
    (match, quote: string, importPath: string) => {
      const resolvedPath = resolveWorkspaceDistInternalImport(`#${importPath}`, id, projectRoot);
      if (!resolvedPath) return match;

      rewritten = true;
      return `${quote}${toRelativeImportPath(importerPath, resolvedPath)}${quote}`;
    },
  );

  return rewritten ? output : undefined;
}

export function createWorkspaceDistInternalImportResolverPlugin(
  projectRoot: string | undefined,
): WorkspaceDistInternalImportResolverPlugin {
  return {
    name: 'shipfox-vitest-workspace-dist-internal-imports',
    enforce: 'pre',
    resolveId(source: string, importer: string | undefined) {
      return resolveWorkspaceDistInternalImport(source, importer, projectRoot);
    },
    transform(code: string, id: string) {
      return rewriteWorkspaceDistInternalImports(code, id, projectRoot);
    },
  };
}

// Vite owns separate resolvers for environments such as `client` and `ssr`, so
// top-level `resolve`/`ssr.resolve` settings are not enough for workspace projects.
function createWorkspaceDistResolutionPlugin(
  packageNames: string[],
  projectRoot: string | undefined,
  serverExcludedConditions: string[],
) {
  return {
    name: 'shipfox-vitest-workspace-dist-resolution',
    enforce: 'pre',
    resolveId(source: string, importer: string | undefined) {
      return resolveWorkspaceDistInternalImport(source, importer, projectRoot);
    },
    transform(code: string, id: string) {
      return rewriteWorkspaceDistInternalImports(code, id, projectRoot);
    },
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

function mergeRolldownPlugins(existing: unknown[] | undefined, plugins: unknown[]): unknown[] {
  return [...(existing || []), ...plugins];
}

// OpenTelemetry's `module` entry currently reaches extensionless ESM imports
// that Node cannot load directly. Direct dependants can let Vite optimize that
// ESM graph, but downstream packages need the Node/default condition instead.
function createOpenTelemetrySsrPolicy(projectRoot: string | undefined) {
  const directDependencyNames = getDirectDependencyNames(projectRoot);
  const optimizerIncludes = getResolvableEsmOptimizerPackageNames(directDependencyNames);
  const serverExcludedConditions = getServerExcludedConditions(directDependencyNames);

  return {
    optimizerIncludes,
    serverExcludedConditions,
    serverFallbackConditions: getServerFallbackConditions(serverExcludedConditions),
  };
}

// CI points Shipfox workspace dependencies at built `dist` exports so package
// tests catch the same public-contract breakages that downstream consumers see.
export function createWorkspaceDistConfig(
  config: MergeableConfigInput,
  projectRoot: string | undefined,
): MergeableConfigFragment {
  const workspacePackageNames = getWorkspacePackageNames();
  const openTelemetrySsrPolicy = createOpenTelemetrySsrPolicy(projectRoot);
  const resolveConfig = config.resolve || {};
  const ssrConfig = config.ssr || {};
  const ssrResolveConfig = ssrConfig.resolve || {};
  const testConfig = config.test || {};
  const testDepsConfig = testConfig.deps || {};
  const testDepsOptimizerConfig = testDepsConfig.optimizer || {};
  const testDepsSsrOptimizerConfig = testDepsOptimizerConfig.ssr || {};
  const testServerConfig = testConfig.server || {};
  const testServerDepsConfig = testServerConfig.deps || {};
  const optimizeDepsConfig = config.optimizeDeps || {};
  const optimizeDepsRolldownOptionsConfig = optimizeDepsConfig.rolldownOptions || {};

  return {
    plugins: [
      createWorkspaceDistResolutionPlugin(
        workspacePackageNames,
        projectRoot,
        openTelemetrySsrPolicy.serverExcludedConditions,
      ),
    ],
    optimizeDeps: {
      ...optimizeDepsConfig,
      rolldownOptions: {
        ...optimizeDepsRolldownOptionsConfig,
        plugins: mergeRolldownPlugins(optimizeDepsRolldownOptionsConfig.plugins, [
          createWorkspaceDistInternalImportResolverPlugin(projectRoot),
        ]),
      },
    },
    resolve: {
      ...resolveConfig,
      alias: mergeProjectSourceAliases(resolveConfig.alias, projectRoot),
      conditions: mergeConditions(resolveConfig.conditions, clientDistConditions),
      externalConditions: mergeConditions(resolveConfig.externalConditions, externalDistConditions),
      external: mergeExternalPackages(resolveConfig.external, workspacePackageNames),
    },
    ssr: {
      ...ssrConfig,
      external: mergeExternalPackages(ssrConfig.external, workspacePackageNames),
      resolve: {
        ...ssrResolveConfig,
        conditions: mergeServerConditions(
          ssrResolveConfig.conditions,
          openTelemetrySsrPolicy.serverFallbackConditions,
          openTelemetrySsrPolicy.serverExcludedConditions,
        ),
        externalConditions: mergeConditions(
          ssrResolveConfig.externalConditions,
          externalDistConditions,
        ),
      },
    },
    test: {
      deps: {
        ...testDepsConfig,
        optimizer: {
          ...testDepsOptimizerConfig,
          ssr: {
            ...testDepsSsrOptimizerConfig,
            enabled: true,
            include: mergeStringList(
              testDepsSsrOptimizerConfig.include,
              openTelemetrySsrPolicy.optimizerIncludes,
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
          inline: mergeInlineDeps(testServerDepsConfig.inline, [esmOptimizerInlinePattern]),
        },
      },
    },
  };
}

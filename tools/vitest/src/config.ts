import {getProjectRootPath} from '@shipfox/tool-utils';
import {
  type TestProjectConfiguration,
  type UserWorkspaceConfig,
  defineConfig as vitestDefineConfig,
  defineProject as vitestDefineProject,
} from 'vitest/config';
import type {ConfigInput, MergeableConfigInput} from './config-types.js';
import {createWorkspaceDistConfig} from './workspace-dist-resolution.js';

export type {
  TestProjectConfiguration,
  UserWorkspaceConfig,
} from 'vitest/config';

export type UserConfigExport = ReturnType<typeof vitestDefineConfig>;
export type UserConfigFnObject = () => Parameters<typeof vitestDefineConfig>[0];

export type UserConfig = Parameters<typeof vitestDefineConfig>[0];

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

function mergeProjectPlugins(projects: unknown, plugins: unknown[]): unknown {
  if (!Array.isArray(projects) || plugins.length === 0) return projects;

  return projects.map((project) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) return project;

    const projectConfig = project as {plugins?: unknown[]};
    return {
      ...projectConfig,
      plugins: [...(projectConfig.plugins || []), ...plugins],
    };
  });
}

function createMergedConfig(resolvedConfig: ConfigInput, projectRoot?: string): ConfigInput {
  const mergeableConfig = resolvedConfig as MergeableConfigInput;
  const useBuiltWorkspaceDeps = process.env.CI === 'true';
  const workerPoolConfig = createWorkerPoolConfig();
  const existingPlugins = mergeableConfig.plugins || [];
  const testConfig = mergeableConfig.test || {};
  const optimizeDepsConfig = mergeableConfig.optimizeDeps || {};
  const optimizeDepsRolldownOptionsConfig = optimizeDepsConfig.rolldownOptions || {};
  const workspaceDistConfig = useBuiltWorkspaceDeps
    ? createWorkspaceDistConfig(mergeableConfig, projectRoot)
    : undefined;
  const workspaceOptimizeDepsConfig = workspaceDistConfig?.optimizeDeps;
  const workspaceOptimizeDepsRolldownOptionsConfig =
    workspaceOptimizeDepsConfig?.rolldownOptions || {};
  const workspacePlugins = workspaceDistConfig?.plugins || [];
  const testProjects = mergeProjectPlugins(
    (testConfig as {projects?: unknown[]}).projects,
    workspacePlugins,
  );
  const merged = {
    ...resolvedConfig,
    plugins: [...existingPlugins, ...workspacePlugins],
    ...(workspaceDistConfig?.resolve ? {resolve: workspaceDistConfig.resolve} : {}),
    ...(workspaceDistConfig?.ssr ? {ssr: workspaceDistConfig.ssr} : {}),
    optimizeDeps: {
      ...optimizeDepsConfig,
      ...(workspaceOptimizeDepsConfig || {}),
      rolldownOptions: {
        ...optimizeDepsRolldownOptionsConfig,
        ...workspaceOptimizeDepsRolldownOptionsConfig,
        checks: {
          ...(optimizeDepsRolldownOptionsConfig.checks || {}),
          ...(workspaceOptimizeDepsRolldownOptionsConfig.checks || {}),
          pluginTimings: false,
        },
      },
    },
    test: {
      ...testConfig,
      globals: true,
      ...workerPoolConfig,
      ...(workspaceDistConfig?.test || {}),
      ...(testProjects ? {projects: testProjects} : {}),
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

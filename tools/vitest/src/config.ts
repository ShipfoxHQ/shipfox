import {getProjectRootPath} from '@shipfox/tool-utils';
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
  optimizeDeps?: {
    rolldownOptions?: {
      checks?: Record<string, unknown>;
    };
  };
  test?: {
    exclude?: string[];
  };
};

const maxWorkers = parseMaxWorkers(process.env.SHIPFOX_VITEST_MAX_WORKERS);
const workerPoolDefaults = maxWorkers === undefined ? {} : {maxWorkers};

function parseMaxWorkers(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const maxWorkers = Number(value);
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    throw new Error(`SHIPFOX_VITEST_MAX_WORKERS must be a positive integer, got "${value}".`);
  }

  return maxWorkers;
}

function createMergedConfig(resolvedConfig: ConfigInput, projectRoot?: string): ConfigInput {
  const mergeableConfig = resolvedConfig as MergeableConfigInput;
  const existingPlugins = mergeableConfig.plugins || [];
  const existingTestConfig = mergeableConfig.test || {};
  const merged = {
    ...resolvedConfig,
    plugins: [...existingPlugins],
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
      ...workerPoolDefaults,
      ...existingTestConfig,
      globals: true,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/out/**',
        ...(existingTestConfig.exclude || []),
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

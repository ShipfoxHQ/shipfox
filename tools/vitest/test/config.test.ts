import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {defineConfig} from '../src/config.js';

const existingExternalPattern = /^existing$/;
const workspaceExternalPattern = /^@shipfox\/.+/;
const workspaceDistFilePattern = /\/(?:apps|e2e|infra|libs|tools|turbo)\/.*\/dist\/.*\.m?js$/;
const esmOptimizerInlinePattern = /@opentelemetry\/(?:api|core)/;
const projectRootSlashImportPattern = /^#\/(.+)$/;
const projectRootImportPattern = /^#(?!test\/)(.+)$/;
const vitestSrcReplacementPattern = /\/tools\/vitest\/src\/\$1$/;
const reactUiDistThemePathPattern = /\/libs\/shared\/react\/ui\/dist\/state\/theme\.js$/;
const existingProjectPlugin = {name: 'existing-project-plugin'};
const existingRolldownPlugin = {name: 'existing-rolldown-plugin'};
const nodeOpentelemetryConfigUrl = new URL(
  '../../../libs/shared/node/opentelemetry/vitest.config.ts',
  import.meta.url,
).href;
const runnerProtocolConfigUrl = new URL(
  '../../../libs/runner/protocol/vitest.config.ts',
  import.meta.url,
).href;
const apiAgentConfigUrl = new URL('../../../libs/api/agent/vitest.config.ts', import.meta.url).href;
const clientLogsConfigUrl = new URL('../../../libs/client/logs/vitest.config.ts', import.meta.url)
  .href;
const reactUiDistThemeProviderPath = fileURLToPath(
  new URL('../../../libs/shared/react/ui/dist/components/theme/theme-provider.js', import.meta.url),
);
const relativeReactUiDistThemeProviderPath =
  '../../shared/react/ui/dist/components/theme/theme-provider.js';

describe('defineConfig', () => {
  const originalCi = process.env.CI;
  const originalMaxWorkers = process.env.SHIPFOX_VITEST_MAX_WORKERS;

  afterEach(() => {
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;

    if (originalMaxWorkers === undefined) delete process.env.SHIPFOX_VITEST_MAX_WORKERS;
    else process.env.SHIPFOX_VITEST_MAX_WORKERS = originalMaxWorkers;
  });

  it('keeps local runs on the default workspace source resolution path', () => {
    delete process.env.CI;

    const config = defineConfig({
      test: {
        server: {
          deps: {
            external: [existingExternalPattern],
          },
        },
      },
    }) as {
      resolve?: {alias?: unknown; conditions?: string[]; external?: string[] | true};
      test?: {server?: {deps?: {external?: unknown[]}}};
    };

    expect(config.resolve?.alias).toBeUndefined();
    expect(config.resolve?.conditions).toBeUndefined();
    expect(config.resolve?.external).toBeUndefined();
    expect(config.test?.server?.deps?.external).toEqual([existingExternalPattern]);
  });

  it('resolves Shipfox workspace dependencies through built package exports on CI', () => {
    process.env.CI = 'true';
    process.env.SHIPFOX_VITEST_MAX_WORKERS = '2';

    const config = defineConfig(
      {
        resolve: {
          conditions: ['module', 'browser', 'development', 'custom'],
        },
        ssr: {
          external: ['existing-ssr-package'],
          resolve: {
            conditions: ['module', 'node', 'development|production', 'custom-ssr'],
          },
        },
        optimizeDeps: {
          rolldownOptions: {
            plugins: [existingRolldownPlugin],
          },
        },
        test: {
          projects: [
            {
              extends: true,
              plugins: [existingProjectPlugin],
              test: {
                name: 'storybook',
              },
            },
          ],
          deps: {
            optimizer: {
              ssr: {
                include: ['existing-optimizer-package'],
              },
            },
          },
          server: {
            deps: {
              external: [existingExternalPattern],
              inline: ['existing-inline-package'],
            },
          },
        },
      },
      import.meta.url,
    ) as {
      plugins?: Array<{
        name?: string;
        resolveId?: (source: string, importer?: string) => string | undefined;
        transform?: (code: string, id: string) => string | undefined;
        configEnvironment?: (
          name: string,
          config: {resolve?: {alias?: Array<{find: RegExp}>; conditions?: string[]}},
        ) => void;
      }>;
      resolve?: {
        alias?: Array<{find: RegExp; replacement: string}>;
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
          plugins?: Array<{
            name?: string;
            resolveId?: (source: string, importer?: string) => string | undefined;
            transform?: (code: string, id: string) => string | undefined;
          }>;
        };
      };
      test?: {
        maxWorkers?: number;
        projects?: Array<{
          plugins?: Array<{
            name?: string;
          }>;
        }>;
        deps?: {
          optimizer?: {
            ssr?: {
              enabled?: boolean;
              include?: string[];
            };
          };
        };
        server?: {deps?: {external?: unknown[]; inline?: unknown[] | true}};
      };
    };
    const workspaceDistPlugin = config.plugins?.find(
      (plugin) => plugin.name === 'shipfox-vitest-workspace-dist-resolution',
    );
    const optimizerResolverPlugin = config.optimizeDeps?.rolldownOptions?.plugins?.find(
      (plugin) => plugin.name === 'shipfox-vitest-workspace-dist-internal-imports',
    );
    const environmentConfig: {
      resolve: {alias?: Array<{find: RegExp}>; conditions: string[]};
    } = {
      resolve: {
        conditions: ['custom-env', 'development|production'],
      },
    };

    expect(config.resolve?.alias?.[0]?.find).toEqual(projectRootSlashImportPattern);
    expect(config.resolve?.alias?.[0]?.replacement).toMatch(vitestSrcReplacementPattern);
    expect(config.resolve?.alias?.[1]?.find).toEqual(projectRootImportPattern);
    expect(config.resolve?.alias?.[1]?.replacement).toMatch(vitestSrcReplacementPattern);
    expect(config.resolve?.conditions).toEqual(['module', 'browser', 'custom']);
    expect(config.resolve?.externalConditions).toEqual(['node', 'module-sync']);
    expect(config.resolve?.external).toContain('@shipfox/vitest');
    expect(config.resolve?.external).toContain('@shipfox/react-ui');
    expect(config.ssr?.resolve?.conditions).toEqual(['node', 'custom-ssr']);
    expect(config.ssr?.resolve?.externalConditions).toEqual(['node', 'module-sync']);
    expect(config.ssr?.external).toContain('existing-ssr-package');
    expect(config.ssr?.external).toContain('@shipfox/vitest');
    expect(config.ssr?.external).toContain('@shipfox/react-ui');
    expect(config.optimizeDeps?.rolldownOptions?.checks).toEqual({
      pluginTimings: false,
    });
    expect(config.optimizeDeps?.rolldownOptions?.plugins?.[0]).toBe(existingRolldownPlugin);
    expect(optimizerResolverPlugin).toBeDefined();
    expect(config.test?.projects?.[0]?.plugins?.[0]).toBe(existingProjectPlugin);
    expect(
      config.test?.projects?.[0]?.plugins?.some(
        (plugin) => plugin.name === 'shipfox-vitest-workspace-dist-resolution',
      ),
    ).toBe(true);
    expect(config.test?.server?.deps?.external).toEqual([
      existingExternalPattern,
      workspaceExternalPattern,
      workspaceDistFilePattern,
    ]);
    expect(config.test?.server?.deps?.inline).toEqual([
      'existing-inline-package',
      esmOptimizerInlinePattern,
    ]);
    expect(config.test?.deps?.optimizer?.ssr?.enabled).toBe(true);
    expect(config.test?.deps?.optimizer?.ssr?.include).toEqual(['existing-optimizer-package']);
    expect(config.test?.maxWorkers).toBe(2);
    workspaceDistPlugin?.configEnvironment?.('ssr', environmentConfig);
    expect(environmentConfig.resolve.alias?.[0]?.find).toEqual(projectRootSlashImportPattern);
    expect(environmentConfig.resolve.alias?.[1]?.find).toEqual(projectRootImportPattern);
    expect(environmentConfig.resolve.conditions).toEqual(['custom-env', 'node']);
    expect(
      workspaceDistPlugin?.resolveId?.('#state/theme.js', reactUiDistThemeProviderPath),
    ).toMatch(reactUiDistThemePathPattern);
    expect(
      workspaceDistPlugin?.resolveId?.('#state/theme.js', `/@fs${reactUiDistThemeProviderPath}`),
    ).toMatch(reactUiDistThemePathPattern);
    expect(
      workspaceDistPlugin?.transform?.(
        'import { ThemeProviderContext } from "#state/theme.js";',
        reactUiDistThemeProviderPath,
      ),
    ).toBe('import { ThemeProviderContext } from "../../state/theme.js";');
  });

  it('resolves built workspace package internals during optimizer scans', () => {
    process.env.CI = 'true';

    const config = defineConfig({}, clientLogsConfigUrl) as {
      optimizeDeps?: {
        rolldownOptions?: {
          plugins?: Array<{
            name?: string;
            resolveId?: (source: string, importer?: string) => string | undefined;
            transform?: (code: string, id: string) => string | undefined;
          }>;
        };
      };
    };
    const optimizerResolverPlugin = config.optimizeDeps?.rolldownOptions?.plugins?.find(
      (plugin) => plugin.name === 'shipfox-vitest-workspace-dist-internal-imports',
    );

    expect(
      optimizerResolverPlugin?.resolveId?.('#state/theme.js', relativeReactUiDistThemeProviderPath),
    ).toMatch(reactUiDistThemePathPattern);
    expect(
      optimizerResolverPlugin?.transform?.(
        'import { ThemeProviderContext } from "#state/theme.js";',
        relativeReactUiDistThemeProviderPath,
      ),
    ).toBe('import { ThemeProviderContext } from "../../state/theme.js";');
  });

  it('optimizes direct OpenTelemetry dependencies when a package lists them', () => {
    process.env.CI = 'true';

    const config = defineConfig({}, nodeOpentelemetryConfigUrl) as {
      test?: {
        deps?: {
          optimizer?: {
            ssr?: {
              enabled?: boolean;
              include?: string[];
            };
          };
        };
        server?: {deps?: {inline?: unknown[] | true}};
      };
    };

    expect(config.test?.server?.deps?.inline).toEqual([esmOptimizerInlinePattern]);
    expect(config.test?.deps?.optimizer?.ssr?.enabled).toBe(true);
    expect(config.test?.deps?.optimizer?.ssr?.include).toEqual([
      '@opentelemetry/api',
      '@opentelemetry/core',
    ]);
  });

  it('does not optimize transitive OpenTelemetry dependencies from downstream packages', () => {
    process.env.CI = 'true';

    const config = defineConfig({}, runnerProtocolConfigUrl) as {
      test?: {
        deps?: {
          optimizer?: {
            ssr?: {
              enabled?: boolean;
              include?: string[];
            };
          };
        };
        server?: {deps?: {inline?: unknown[] | true}};
      };
    };

    expect(config.test?.server?.deps?.inline).toEqual([esmOptimizerInlinePattern]);
    expect(config.test?.deps?.optimizer?.ssr?.enabled).toBe(true);
    expect(config.test?.deps?.optimizer?.ssr?.include).toEqual([]);
  });

  it('keeps partial direct OpenTelemetry dependencies on Node conditions', () => {
    process.env.CI = 'true';

    const config = defineConfig({}, apiAgentConfigUrl) as {
      ssr?: {
        resolve?: {
          conditions?: string[];
        };
      };
      test?: {
        deps?: {
          optimizer?: {
            ssr?: {
              enabled?: boolean;
              include?: string[];
            };
          };
        };
        server?: {deps?: {inline?: unknown[] | true}};
      };
    };

    expect(config.ssr?.resolve?.conditions).toEqual(['node']);
    expect(config.test?.server?.deps?.inline).toEqual([esmOptimizerInlinePattern]);
    expect(config.test?.deps?.optimizer?.ssr?.enabled).toBe(true);
    expect(config.test?.deps?.optimizer?.ssr?.include).toEqual([]);
  });
});

import {
  type ConfigEnv,
  defaultClientConditions,
  defaultServerConditions,
  type UserConfig,
  type UserConfigExport,
  type UserConfigFnObject,
  defineConfig as viteDefinedConfig,
} from 'vite';
import {workspaceSourceResolver} from './workspace-source.js';

export type {ConfigEnv, UserConfig, UserConfigExport, UserConfigFnObject} from 'vite';
export {loadEnv} from 'vite';

export function defineConfig(configOrFn?: UserConfig | UserConfigFnObject): UserConfigExport {
  const mergeConfig = (config: UserConfig | undefined, command: ConfigEnv['command']) => {
    const sourceConditions = command === 'serve' ? ['workspace-source'] : [];
    const resolveConditions = config?.resolve?.conditions ?? [
      ...defaultClientConditions,
      ...sourceConditions,
    ];
    const ssrResolveConditions = config?.ssr?.resolve?.conditions ?? [
      ...defaultServerConditions,
      ...sourceConditions,
    ];
    return {
      ...config,
      plugins: [
        ...(config?.plugins ?? []),
        ...(command === 'serve' &&
        (resolveConditions.includes('workspace-source') ||
          ssrResolveConditions.includes('workspace-source'))
          ? [workspaceSourceResolver()]
          : []),
      ],
      resolve: {
        tsconfigPaths: true,
        conditions: resolveConditions,
        ...config?.resolve,
      },
      ssr: {
        ...config?.ssr,
        resolve: {
          conditions: ssrResolveConditions,
          ...config?.ssr?.resolve,
        },
      },
    };
  };
  const config =
    typeof configOrFn === 'function'
      ? (env: ConfigEnv) => mergeConfig(configOrFn(env), env.command)
      : (env: ConfigEnv) => mergeConfig(configOrFn, env.command);
  return viteDefinedConfig(config);
}

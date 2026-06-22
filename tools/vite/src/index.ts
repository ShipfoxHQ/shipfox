import {
  type ConfigEnv,
  type UserConfig,
  type UserConfigExport,
  type UserConfigFnObject,
  defineConfig as viteDefinedConfig,
} from 'vite';

export type {ConfigEnv, UserConfig, UserConfigExport, UserConfigFnObject} from 'vite';
export {loadEnv} from 'vite';

export function defineConfig(configOrFn?: UserConfig | UserConfigFnObject): UserConfigExport {
  const mergeConfig = (config?: UserConfig) => ({
    ...config,
    resolve: {tsconfigPaths: true, ...config?.resolve},
  });
  const config =
    typeof configOrFn === 'function'
      ? (env: ConfigEnv) => mergeConfig(configOrFn(env))
      : mergeConfig(configOrFn ?? {});
  return viteDefinedConfig(config);
}

import {
  type ConfigEnv,
  type UserConfig,
  type UserConfigExport,
  type UserConfigFnObject,
  defaultClientConditions,
  defaultServerConditions,
  defineConfig as viteDefinedConfig,
} from 'vite';

export type {ConfigEnv, UserConfig, UserConfigExport, UserConfigFnObject} from 'vite';
export {loadEnv} from 'vite';

export function defineConfig(configOrFn?: UserConfig | UserConfigFnObject): UserConfigExport {
  const mergeConfig = (config: UserConfig | undefined, command: ConfigEnv['command']) => {
    const sourceConditions = command === 'serve' ? ['workspace-source'] : [];
    return {
      ...config,
      resolve: {
        tsconfigPaths: true,
        conditions: [...defaultClientConditions, ...sourceConditions],
        ...config?.resolve,
      },
      ssr: {
        ...config?.ssr,
        resolve: {
          conditions: [...defaultServerConditions, ...sourceConditions],
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

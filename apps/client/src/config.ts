/// <reference types="@shipfox/vite/client" />

import {apiConfigShape} from '@shipfox/client-api';
import {
  type ConfigResult,
  getLoadedConfig,
  getWindowRuntimeConfig,
  loadConfig,
  useConfig,
} from '@shipfox/client-config';
import {z} from 'zod';

// Each feature module owns the config fragment it needs; the composition root
// merges them into the one schema validated at boot.
const appConfigShape = {
  ...apiConfigShape,
  environment: z
    .enum(['development', 'staging', 'production'])
    .default('production')
    .describe('Deployment environment name shown in diagnostics and reported to monitoring.'),
};

export type AppConfig = z.infer<z.ZodObject<typeof appConfigShape>>;

export function loadAppConfig(): ConfigResult<AppConfig> {
  return loadConfig(appConfigShape, {
    runtime: getWindowRuntimeConfig(),
    build: import.meta.env,
  });
}

export const getAppConfig = (): AppConfig => getLoadedConfig<AppConfig>();

export const useAppConfig = (): AppConfig => useConfig<AppConfig>();

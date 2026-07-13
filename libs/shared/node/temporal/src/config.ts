import {createConfig, str} from '@shipfox/config';

const TEMPORAL_CLOUD_ADDRESS_PATTERN = /\.tmprl\.cloud(?::\d+)?$/i;

export const temporalConfigSchema = {
  TEMPORAL_ADDRESS: str({
    desc: 'Address of the Temporal server in host:port form. Temporal Cloud uses <namespace>.<account>.tmprl.cloud:7233.',
    default: 'localhost:7233',
  }),
  TEMPORAL_NAMESPACE: str({
    desc: 'Temporal namespace that workflows and activities run in. Temporal Cloud uses <namespace>.<account>.',
    default: 'default',
  }),
  TEMPORAL_TASK_QUEUE: str({
    desc: 'Task queue that workers and clients share. Workers and clients must use the same value.',
    default: 'shipfox',
  }),
  TEMPORAL_API_KEY: str({
    desc: 'API key used to authenticate with Temporal Cloud. Store it as a secret. It is required for tmprl.cloud endpoints and must be unset for other endpoints.',
    default: undefined,
  }),
};

export function loadTemporalConfig(update?: Partial<NodeJS.ProcessEnv>) {
  const loadedConfig = createConfig(temporalConfigSchema, update);
  const usesTemporalCloud = isTemporalCloudAddress(loadedConfig.TEMPORAL_ADDRESS);

  if (usesTemporalCloud && !loadedConfig.TEMPORAL_API_KEY) {
    throw new Error('TEMPORAL_API_KEY is required when TEMPORAL_ADDRESS points to Temporal Cloud');
  }
  if (!usesTemporalCloud && loadedConfig.TEMPORAL_API_KEY) {
    throw new Error(
      'TEMPORAL_API_KEY must be unset when TEMPORAL_ADDRESS does not point to Temporal Cloud',
    );
  }

  return loadedConfig;
}

export type TemporalConfig = ReturnType<typeof loadTemporalConfig>;

export const config = loadTemporalConfig();

function isTemporalCloudAddress(address: string): boolean {
  return TEMPORAL_CLOUD_ADDRESS_PATTERN.test(address);
}

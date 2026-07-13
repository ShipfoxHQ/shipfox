import {config, type TemporalConfig} from './config.js';

export interface TemporalConnectionOptions {
  address: string;
  apiKey?: string;
  tls?: true;
}

export function getTemporalConnectionOptions(
  temporalConfig: TemporalConfig = config,
): TemporalConnectionOptions {
  const {TEMPORAL_ADDRESS: address, TEMPORAL_API_KEY: apiKey} = temporalConfig;

  if (!apiKey) return {address};

  return {address, apiKey, tls: true};
}

export function temporalConnectionError(
  error: unknown,
  temporalConfig: TemporalConfig = config,
): Error {
  const credentialHint = temporalConfig.TEMPORAL_API_KEY
    ? 'Verify TEMPORAL_ADDRESS and TEMPORAL_API_KEY.'
    : 'Verify TEMPORAL_ADDRESS and that the Temporal service is reachable.';

  return new Error(`Failed to connect to Temporal. ${credentialHint}`, {cause: error});
}

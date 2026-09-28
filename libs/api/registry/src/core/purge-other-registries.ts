import {logger} from '@shipfox/node-opentelemetry';
import {deleteVersionsOfOtherRegistries} from '#db/versions.js';
import type {RegistrySettings} from './settings.js';

/** Reads only use rows of the configured registry, so rows of any other registry are dead weight. */
export async function purgeOtherRegistries(params: {settings: RegistrySettings}): Promise<number> {
  const deleted = await deleteVersionsOfOtherRegistries({registry: params.settings.registry});
  if (deleted > 0) logger().info({deleted}, 'Purged cached versions of other registries');
  return deleted;
}

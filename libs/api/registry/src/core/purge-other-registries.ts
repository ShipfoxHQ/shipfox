import {logger} from '@shipfox/node-opentelemetry';
import {deleteIndexesOfOtherRegistries} from '#db/indexes.js';
import {deleteVersionsOfOtherRegistries} from '#db/versions.js';
import type {RegistrySettings} from './settings.js';

/** Reads only use rows of the configured registry, so rows of any other registry are dead weight. */
export async function purgeOtherRegistries(params: {settings: RegistrySettings}): Promise<number> {
  const {registry} = params.settings;
  const versions = await deleteVersionsOfOtherRegistries({registry});
  const indexes = await deleteIndexesOfOtherRegistries({registry});
  const deleted = versions + indexes;
  if (deleted > 0) logger().info({versions, indexes}, 'Purged cached rows of other registries');
  return deleted;
}

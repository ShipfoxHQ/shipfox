import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export {closeDb, db} from './db.js';
export {registryVersions} from './schema/versions.js';
export {
  deleteRegistryVersion,
  deleteVersionsOfOtherRegistries,
  getRegistryVersion,
  insertRegistryVersion,
  setRegistryVersionReadme,
  setRegistryVersionSource,
} from './versions.js';

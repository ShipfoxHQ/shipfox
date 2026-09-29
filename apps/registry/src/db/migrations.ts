import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runMigrations} from '@shipfox/node-drizzle';
import {db} from '#db/db.js';

export const DATABASE_NAMESPACE = 'registry';

const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export function migrateRegistryDatabase(): Promise<void> {
  return runMigrations(db(), migrationsPath, `__drizzle_migrations_${DATABASE_NAMESPACE}`);
}

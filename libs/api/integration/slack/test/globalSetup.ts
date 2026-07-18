import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_integrations_slack');
  const {secretsModule} = await import('@shipfox/api-secrets');
  if (!secretsModule.database || Array.isArray(secretsModule.database)) {
    throw new Error('Secrets module database is not configured');
  }
  await runMigrations(
    secretsModule.database.db(),
    secretsModule.database.migrationsPath,
    '__drizzle_migrations_secrets',
  );

  closeDb();
  await closePostgresClient();
}

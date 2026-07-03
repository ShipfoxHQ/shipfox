import './env.js';
import {secretsModule} from '@shipfox/api-secrets';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_agent');
  if (!secretsModule.database || Array.isArray(secretsModule.database)) {
    throw new Error('Secrets module database is not configured');
  }
  await runMigrations(
    secretsModule.database.db(),
    secretsModule.database.migrationsPath,
    '__drizzle_migrations_secrets',
  );
  await db().execute(sql`TRUNCATE model_provider_configs CASCADE`);
  await db().execute(sql`TRUNCATE agent_workspace_settings CASCADE`);

  closeDb();
  await closePostgresClient();
}

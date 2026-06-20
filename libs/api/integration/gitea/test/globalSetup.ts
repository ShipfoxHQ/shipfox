import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_integrations_gitea');

  closeDb();
  await closePostgresClient();
}

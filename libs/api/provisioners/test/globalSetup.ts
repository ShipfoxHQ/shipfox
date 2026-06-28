import './env.js';
import {migrationsPath as workspacesMigrationsPath} from '@shipfox/api-workspaces';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), workspacesMigrationsPath, '__drizzle_migrations_workspaces');
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_provisioners');
  await db().execute(sql`TRUNCATE provisioners_provisioner_tokens CASCADE`);

  closeDb();
  await closePostgresClient();
}

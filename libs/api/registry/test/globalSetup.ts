import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();
  await db().execute(sql`DROP TABLE IF EXISTS registry_indexes CASCADE`);
  await db().execute(sql`DROP TABLE IF EXISTS registry_versions CASCADE`);
  await db().execute(sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations_registry CASCADE`);
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_registry');

  closeDb();
  await closePostgresClient();
}

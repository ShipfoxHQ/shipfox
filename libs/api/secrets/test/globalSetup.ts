import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_secrets');
  await db().execute(sql`TRUNCATE secrets_values CASCADE`);
  await db().execute(sql`TRUNCATE secrets_variables CASCADE`);
  await db().execute(sql`TRUNCATE secrets_data_keys CASCADE`);

  closeDb();
  await closePostgresClient();
}

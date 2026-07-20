import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
export async function setup() {
  createPostgresClient();
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_email_challenges');
  await db().execute(sql`TRUNCATE email_challenges_challenges, email_challenges_send_limits`);
  closeDb();
  await closePostgresClient();
}

import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_logs');
  await db().execute(sql`TRUNCATE logs_chunks CASCADE`);
  await db().execute(sql`TRUNCATE logs_attempt_streams CASCADE`);
  await db().execute(sql`TRUNCATE logs_job_accounting CASCADE`);
  await db().execute(sql`TRUNCATE logs_outbox CASCADE`);

  closeDb();
  await closePostgresClient();
}

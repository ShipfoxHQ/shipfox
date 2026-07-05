import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_triggers');
  await db().execute(sql`TRUNCATE triggers_job_listener_subscriptions CASCADE`);
  await db().execute(sql`TRUNCATE triggers_cron_schedules CASCADE`);
  await db().execute(sql`TRUNCATE triggers_subscriptions CASCADE`);
  await db().execute(sql`TRUNCATE triggers_outbox CASCADE`);
  await db().execute(sql`TRUNCATE triggers_received_events CASCADE`);
  await db().execute(sql`TRUNCATE triggers_decisions CASCADE`);

  closeDb();
  await closePostgresClient();
}

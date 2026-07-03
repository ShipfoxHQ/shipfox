import './env.js';
import {agentModule} from '@shipfox/api-agent';
import {runnersModule} from '@shipfox/api-runners';
import {secretsModule} from '@shipfox/api-secrets';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  if (!agentModule.database || Array.isArray(agentModule.database)) {
    throw new Error('Agent module database is not configured');
  }
  await runMigrations(
    agentModule.database.db(),
    agentModule.database.migrationsPath,
    '__drizzle_migrations_agent',
  );
  if (!runnersModule.database || Array.isArray(runnersModule.database)) {
    throw new Error('Runners module database is not configured');
  }
  await runMigrations(
    runnersModule.database.db(),
    runnersModule.database.migrationsPath,
    '__drizzle_migrations_runners',
  );
  if (!secretsModule.database || Array.isArray(secretsModule.database)) {
    throw new Error('Secrets module database is not configured');
  }
  await runMigrations(
    secretsModule.database.db(),
    secretsModule.database.migrationsPath,
    '__drizzle_migrations_secrets',
  );
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_workflows');
  await db().execute(sql`TRUNCATE workflows_workflow_runs CASCADE`);
  await db().execute(sql`TRUNCATE workflows_job_listener_events CASCADE`);
  await db().execute(sql`TRUNCATE workflows_outbox CASCADE`);

  closeDb();
  await closePostgresClient();
}

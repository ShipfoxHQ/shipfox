import './env.js';
import {agentModule} from '@shipfox/api-agent';
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
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_workflows');
  await db().execute(sql`TRUNCATE agent_provider_configs CASCADE`);
  await db().execute(sql`TRUNCATE agent_workspace_settings CASCADE`);
  await db().execute(sql`TRUNCATE workflows_workflow_runs CASCADE`);
  await db().execute(sql`TRUNCATE workflows_outbox CASCADE`);

  closeDb();
  await closePostgresClient();
}

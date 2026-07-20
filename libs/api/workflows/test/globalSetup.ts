import './env.js';
import {annotationsModule} from '@shipfox/annotations';
import {createAgentModule} from '@shipfox/api-agent';
import {runnersModule} from '@shipfox/api-runners';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  const agentModule = createAgentModule({
    secrets: {
      deleteSecrets: async () => ({deleted: 0}),
      getSecretsByNamespace: async () => ({values: {}}),
      setSecrets: async () => ({}),
    },
  });
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
  if (!annotationsModule.database || Array.isArray(annotationsModule.database)) {
    throw new Error('Annotations module database is not configured');
  }
  await runMigrations(
    annotationsModule.database.db(),
    annotationsModule.database.migrationsPath,
    '__drizzle_migrations_annotations',
  );
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_workflows');
  await db().execute(sql`TRUNCATE workflows_workflow_runs CASCADE`);
  await db().execute(sql`TRUNCATE workflows_job_listener_events CASCADE`);
  await db().execute(sql`TRUNCATE workflows_outbox CASCADE`);
  await db().execute(sql`TRUNCATE annotations_annotations CASCADE`);

  closeDb();
  await closePostgresClient();
}

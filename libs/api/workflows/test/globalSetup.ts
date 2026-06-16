import './env.js';
import {db as projectsDb, migrationsPath as projectsMigrationsPath} from '@shipfox/api-projects';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb as closeWorkflowsDb, migrationsPath, db as workflowsDb} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(projectsDb(), projectsMigrationsPath, '__drizzle_migrations_projects');
  await runMigrations(workflowsDb(), migrationsPath, '__drizzle_migrations_workflows');
  await workflowsDb().execute(sql`TRUNCATE workflows_workflow_runs CASCADE`);
  await workflowsDb().execute(sql`TRUNCATE workflows_outbox CASCADE`);
  await projectsDb().execute(sql`TRUNCATE projects_projects CASCADE`);
  await projectsDb().execute(sql`TRUNCATE projects_outbox CASCADE`);

  closeWorkflowsDb();
  await closePostgresClient();
}

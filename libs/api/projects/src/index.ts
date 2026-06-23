import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  type IntegrationsEventMap,
} from '@shipfox/api-integration-core-dto';
import {projectsEventSchemas} from '@shipfox/api-projects-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, projectsOutbox} from '#db/index.js';
import {createProjectRoutes} from '#presentation/index.js';
import {onSourceCommitPushed} from '#presentation/subscribers/index.js';
import {createProjectsMaintenanceActivities} from '#temporal/activities/index.js';
import {PROJECTS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maintenanceWorkflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<IntegrationsEventMap>();

export type {Project} from '#core/index.js';
export {
  createProjectFromSource,
  ProjectAccessDeniedError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
} from '#core/index.js';
export type {GetProjectBySourceParams} from '#db/index.js';
export {
  createProject,
  db,
  getProjectById,
  getProjectBySource,
  listProjects,
  migrationsPath,
  projectsOutbox,
  requireProjectForWorkspace,
} from '#db/index.js';
export {createProjectRoutes, requireProjectAccess} from '#presentation/index.js';

export interface CreateProjectsModuleOptions {
  sourceControl: IntegrationSourceControlService;
}

export function createProjectsModule({sourceControl}: CreateProjectsModuleOptions): ShipfoxModule {
  return {
    name: 'projects',
    database: {db, migrationsPath},
    routes: createProjectRoutes(sourceControl),
    publishers: [{name: 'projects', table: projectsOutbox, db, eventSchemas: projectsEventSchemas}],
    subscribers: [subscriber(INTEGRATION_SOURCE_COMMIT_PUSHED, onSourceCommitPushed)],
    workers: [
      {
        taskQueue: PROJECTS_MAINTENANCE_TASK_QUEUE,
        workflowsPath: maintenanceWorkflowsPath,
        activities: createProjectsMaintenanceActivities,
        workflows: [
          {
            name: 'pruneIntegrationEventDedupCron',
            id: 'projects-prune-integration-event-dedup',
            cronSchedule: '0 3 * * *',
          },
        ],
      },
    ],
  };
}

import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {
  INTEGRATION_CONNECTION_DELETED,
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  INTEGRATION_SOURCE_REPOSITORY_UPDATED,
  type IntegrationsEventMap,
} from '@shipfox/api-integration-core-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {projectsEventSchemas} from '@shipfox/api-projects-dto';
import {WORKSPACES_WORKSPACE_CREATED, type WorkspacesEventMap} from '@shipfox/api-workspaces-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import type {FeatureFlags} from '@shipfox/node-feature-flags';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, projectsOutbox} from '#db/index.js';
import {registerProjectsServiceMetrics} from '#metrics/index.js';
import {projectsE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createProjectRoutes} from '#presentation/index.js';
import {createProjectsInterModulePresentation} from '#presentation/inter-module.js';
import {
  onConnectionDeleted,
  onSourceCommitPushed,
  onSourceRepositoryUpdated,
  onWorkspaceCreated,
} from '#presentation/subscribers/index.js';
import {createProjectsMaintenanceActivities} from '#temporal/activities/index.js';
import {PROJECTS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';
import {projectsFlags} from './flags.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maintenanceWorkflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<IntegrationsEventMap & WorkspacesEventMap>();

export type {Project} from '#core/index.js';
export {
  backfillDefaultProjects,
  createManagedProject,
  createProjectFromSource,
  ensureDefaultProject,
  ProjectAccessDeniedError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  updateProjectDetails,
} from '#core/index.js';
export type {
  FindProjectBySourceRepositoryNameParams,
  GetProjectBySourceParams,
} from '#db/index.js';
export {
  createProject,
  db,
  findProjectBySourceRepositoryName,
  getProjectById,
  getProjectBySource,
  getWorkspaceProjectCounts,
  listProjects,
  migrationsPath,
  projectsOutbox,
  requireProjectForWorkspace,
} from '#db/index.js';
export {createProjectRoutes, requireProjectAccess} from '#presentation/index.js';
export {projectsFlags} from './flags.js';

export interface CreateProjectsModuleOptions {
  integrations: IntegrationsModuleClient;
  auth: AuthInterModuleClient;
  workspaces: Pick<WorkspacesInterModuleClient, 'listAdminWorkspaces'>;
  flags: FeatureFlags;
}

export function createProjectsModule({
  integrations,
  auth,
  workspaces,
  flags,
}: CreateProjectsModuleOptions): ShipfoxModule {
  return {
    name: 'projects',
    flags: projectsFlags,
    database: {db, migrationsPath, databaseNamespace: 'projects'},
    routes: createProjectRoutes(integrations, auth, workspaces, flags),
    e2eRoutes: [projectsE2eRoutes],
    metrics: registerProjectsServiceMetrics,
    publishers: [{name: 'projects', table: projectsOutbox, db, eventSchemas: projectsEventSchemas}],
    interModulePresentations: [createProjectsInterModulePresentation()],
    subscribers: [
      subscriber(INTEGRATION_CONNECTION_DELETED, onConnectionDeleted),
      subscriber(INTEGRATION_SOURCE_COMMIT_PUSHED, onSourceCommitPushed),
      subscriber(INTEGRATION_SOURCE_REPOSITORY_UPDATED, onSourceRepositoryUpdated),
      subscriber(WORKSPACES_WORKSPACE_CREATED, (payload) =>
        onWorkspaceCreated(payload, {integrations}),
      ),
    ],
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

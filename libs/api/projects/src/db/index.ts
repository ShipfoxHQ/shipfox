import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {
  deleteIntegrationEventDedupForProject,
  pruneIntegrationEventDedup,
  recordIntegrationEventForProject,
} from './integration-event-dedup.js';
export type {
  AdminProjectSummary,
  CreateProjectParams,
  FindProjectBySourceRepositoryNameParams,
  GetProjectBySourceParams,
  ListAdminProjectsParams,
  ListAdminProjectsResult,
  ListProjectsParams,
  ListProjectsResult,
  ProjectLabel,
  ResolveCheckoutTargetParams,
  ResolvedCheckoutTarget,
  UpdateProjectParams,
  UpdateProjectResult,
} from './projects.js';
export {
  createProject,
  findProjectBySourceRepositoryName,
  getDefaultProject,
  getProjectById,
  getProjectBySource,
  getProjectCount,
  getProjectLabelsByIds,
  getWorkspaceProjectCounts,
  listAdminProjects,
  listProjects,
  requireProjectForWorkspace,
  resolveCheckoutTarget,
  updateProject,
} from './projects.js';
export {projectsIntegrationEventDedup} from './schema/integration-event-dedup.js';
export {projectsOutbox} from './schema/outbox.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

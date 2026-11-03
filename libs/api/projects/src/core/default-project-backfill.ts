import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {
  listProjectsMissingRepositoryCoordinates,
  type ProjectMissingRepositoryCoordinates,
  updateProjectSourceRepository,
} from '#db/projects.js';
import {ensureDefaultProject} from './default-project.js';

const PAGE_SIZE = 100;
type WorkspacePage = Awaited<ReturnType<WorkspacesInterModuleClient['listAdminWorkspaces']>>;
// Deleted workspaces are skipped. A suspended workspace still has projects.
const BACKFILLED_WORKSPACE_STATUSES = ['active', 'suspended'] as const;

export interface BackfillDefaultProjectsParams {
  actorId: string;
  workspaces: Pick<WorkspacesInterModuleClient, 'listAdminWorkspaces'>;
  integrations: IntegrationsModuleClient;
}

export interface BackfillDefaultProjectsResult {
  workspacesChecked: number;
  defaultsCreated: number;
  repositoriesFilled: number;
  failures: number;
}

/**
 * Gives every workspace that isn't deleted a default project, then fills the owner and name of
 * the config repository of every project that lacks them. Safe to run again: a repeat run finds
 * the work done and changes nothing. A workspace or project that fails is logged and counted,
 * and the run goes on, so one broken installation can't block the release.
 */
export async function backfillDefaultProjects(
  params: BackfillDefaultProjectsParams,
): Promise<BackfillDefaultProjectsResult> {
  const result: BackfillDefaultProjectsResult = {
    workspacesChecked: 0,
    defaultsCreated: 0,
    repositoriesFilled: 0,
    failures: 0,
  };
  await backfillDefaults(params, result);
  await backfillRepositoryCoordinates(params, result);
  return result;
}

async function backfillDefaults(
  params: BackfillDefaultProjectsParams,
  result: BackfillDefaultProjectsResult,
): Promise<void> {
  for (const status of BACKFILLED_WORKSPACE_STATUSES) {
    let cursor: WorkspacePage['nextCursor'] = null;
    do {
      const page: WorkspacePage = await params.workspaces.listAdminWorkspaces({
        status,
        limit: PAGE_SIZE,
        ...(cursor ? {cursor} : {}),
      });
      for (const workspace of page.workspaces) {
        await backfillDefault(params, workspace.id, result);
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
}

async function backfillDefault(
  params: BackfillDefaultProjectsParams,
  workspaceId: string,
  result: BackfillDefaultProjectsResult,
): Promise<void> {
  result.workspacesChecked += 1;
  try {
    const {created} = await ensureDefaultProject({
      actorId: params.actorId,
      workspaceId,
      integrations: params.integrations,
    });
    if (created) result.defaultsCreated += 1;
  } catch (error) {
    result.failures += 1;
    logger().error(
      {err: error, workspaceId},
      'Could not create the default project of a workspace',
    );
  }
}

async function backfillRepositoryCoordinates(
  params: BackfillDefaultProjectsParams,
  result: BackfillDefaultProjectsResult,
): Promise<void> {
  let afterId: string | undefined;
  let page: ProjectMissingRepositoryCoordinates[];
  do {
    page = await listProjectsMissingRepositoryCoordinates({afterId, limit: PAGE_SIZE});
    for (const project of page) {
      await backfillRepositoryCoordinatesOf(params, project, result);
    }
    afterId = page.at(-1)?.id;
  } while (page.length === PAGE_SIZE);
}

async function backfillRepositoryCoordinatesOf(
  params: BackfillDefaultProjectsParams,
  project: ProjectMissingRepositoryCoordinates,
  result: BackfillDefaultProjectsResult,
): Promise<void> {
  try {
    const source = await params.integrations.resolveSourceRepository({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    await updateProjectSourceRepository({
      workspaceId: project.workspaceId,
      sourceConnectionId: project.sourceConnectionId,
      sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      sourceRepositoryOwner: source.repository.owner,
      sourceRepositoryName: source.repository.name,
      sourceDefaultBranch: source.repository.defaultBranch,
    });
    result.repositoriesFilled += 1;
  } catch (error) {
    // A repository that no longer resolves stays as it is.
    result.failures += 1;
    logger().warn(
      {err: error, projectId: project.id},
      'Could not fill the config repository of a project',
    );
  }
}

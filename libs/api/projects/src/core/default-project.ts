import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {getDefaultProject} from '#db/projects.js';
import type {Project} from './entities/project.js';
import {DefaultProjectExistsError} from './errors.js';
import {createManagedProject} from './projects.js';

export const DEFAULT_PROJECT_NAME = 'Default';
const DEFAULT_PROJECT_SLUG = 'default';
/** The actor of a default project made by a read, with no user behind it. */
export const SYSTEM_ACTOR_ID = 'system';

export interface EnsureDefaultProjectParams {
  actorId: string;
  workspaceId: string;
  integrations: IntegrationsModuleClient;
}

/**
 * Returns the workspace's default project, creating an empty managed one when it has none. It
 * ignores the `managed-config-repos` flag, which gates only the create route. Calls racing for
 * the same workspace end with the same project, because the unique index lets one insert win.
 * A workspace that already has a project with the slug `default` fails with a slug conflict.
 */
export async function ensureDefaultProject(params: EnsureDefaultProjectParams): Promise<Project> {
  const existing = await getDefaultProject(params.workspaceId);
  if (existing) return existing;

  try {
    return await createManagedProject({
      actorId: params.actorId,
      workspaceId: params.workspaceId,
      name: DEFAULT_PROJECT_NAME,
      slug: DEFAULT_PROJECT_SLUG,
      isDefault: true,
      integrations: params.integrations,
    });
  } catch (error) {
    if (error instanceof DefaultProjectExistsError) {
      const winner = await getDefaultProject(params.workspaceId);
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Like `ensureDefaultProject`, for reads that must not fail because the default could not be
 * created. A failure is logged and the next read tries again.
 */
export async function tryEnsureDefaultProject(
  params: EnsureDefaultProjectParams,
): Promise<Project | undefined> {
  try {
    return await ensureDefaultProject(params);
  } catch (error) {
    logger().warn(
      {err: error, workspaceId: params.workspaceId},
      'Could not create the default project of a workspace',
    );
    return undefined;
  }
}

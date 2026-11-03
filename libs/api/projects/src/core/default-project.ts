import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {getDefaultProject, listSlugsWithBase} from '#db/projects.js';
import type {Project} from './entities/project.js';
import {DefaultProjectExistsError, ProjectSlugConflictError} from './errors.js';
import {createManagedProject} from './projects.js';

export const DEFAULT_PROJECT_NAME = 'Default';
const DEFAULT_PROJECT_SLUG = 'default';
// A slug taken between the lookup and the insert is rare, so a few attempts are plenty.
const CREATE_ATTEMPTS = 3;

export interface EnsureDefaultProjectParams {
  actorId: string;
  workspaceId: string;
  integrations: IntegrationsModuleClient;
}

/**
 * Returns the workspace's default project, creating an empty managed one when it has none. It
 * ignores the `managed-config-repos` flag, which gates only the create route. Calls racing for
 * the same workspace end with the same project, because the unique index lets one insert win.
 */
export async function ensureDefaultProject(
  params: EnsureDefaultProjectParams,
): Promise<{project: Project; created: boolean}> {
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const existing = await getDefaultProject(params.workspaceId);
    if (existing) return {project: existing, created: false};

    try {
      const project = await createManagedProject({
        actorId: params.actorId,
        workspaceId: params.workspaceId,
        name: DEFAULT_PROJECT_NAME,
        slug: await pickDefaultSlug(params.workspaceId),
        isDefault: true,
        integrations: params.integrations,
      });
      return {project, created: true};
    } catch (error) {
      if (error instanceof DefaultProjectExistsError) {
        const winner = await getDefaultProject(params.workspaceId);
        if (winner) return {project: winner, created: false};
        continue;
      }
      if (!(error instanceof ProjectSlugConflictError)) throw error;
    }
  }
  throw new Error(`Could not create the default project of workspace ${params.workspaceId}`);
}

async function pickDefaultSlug(workspaceId: string): Promise<string> {
  const taken = new Set(await listSlugsWithBase({workspaceId, base: DEFAULT_PROJECT_SLUG}));
  if (!taken.has(DEFAULT_PROJECT_SLUG)) return DEFAULT_PROJECT_SLUG;
  for (let suffix = 2; ; suffix += 1) {
    const slug = `${DEFAULT_PROJECT_SLUG}-${suffix}`;
    if (!taken.has(slug)) return slug;
  }
}

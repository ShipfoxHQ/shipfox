import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {defaultCheckoutRepository, defaultConnectionId} from '@shipfox/api-projects-dto';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {isManagedProject} from './managed-source.js';

export interface ProjectCheckoutDefaults {
  /** The repository a job checks out when it sets no `checkout`. Null when the project has none. */
  defaultCheckout: {
    connectionId: string;
    externalRepositoryId: string;
    lookupName?: string | null | undefined;
  } | null;
  /** The connection a checkout of a bare `repository` uses. Null when the project has none. */
  defaultConnectionId: string | null;
  /**
   * The connection the project would default to if inactive ones counted. It differs from
   * `defaultConnectionId` only when the project's one connection is not active.
   */
  configuredConnectionId: string | null;
}

type CheckoutDefaultsProject = {
  id: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
};

/**
 * What a job checks out, and on which connection, when it names no target. A linked project
 * defaults to its config repository. A managed project defaults to the one repository its access
 * names, which only its policy and the workspace's source-control connections can tell.
 *
 * Null when the project is gone, which callers treat as no default.
 */
export async function loadProjectCheckoutDefaults(params: {
  project: CheckoutDefaultsProject;
  projects: Pick<ProjectsModuleClient, 'getProjectAccessPolicy'>;
  integrations?: Pick<IntegrationsModuleClient, 'listSourceControlConnectionIds'> | undefined;
}): Promise<ProjectCheckoutDefaults | null> {
  const {project} = params;
  if (!isManagedProject(project)) {
    return {
      defaultCheckout: {
        connectionId: project.sourceConnectionId,
        externalRepositoryId: project.sourceExternalRepositoryId,
      },
      defaultConnectionId: project.sourceConnectionId,
      configuredConnectionId: project.sourceConnectionId,
    };
  }

  try {
    const [{policy}, sourceControl] = await Promise.all([
      params.projects.getProjectAccessPolicy({
        workspaceId: project.workspaceId,
        projectId: project.id,
      }),
      params.integrations?.listSourceControlConnectionIds({workspaceId: project.workspaceId}),
    ]);
    const sourceControlConnectionIds = sourceControl?.connectionIds ?? [];
    return {
      defaultCheckout: defaultCheckoutRepository(policy, {sourceControlConnectionIds}),
      defaultConnectionId: defaultConnectionId(policy, {sourceControlConnectionIds}),
      configuredConnectionId: defaultConnectionId(policy, {
        sourceControlConnectionIds: [
          ...sourceControlConnectionIds,
          ...(sourceControl?.inactiveConnectionIds ?? []),
        ],
      }),
    };
  } catch (error) {
    if (
      isInterModuleKnownError(projectsInterModuleContract.methods.getProjectAccessPolicy, error)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Whether jobs of the project that set no `checkout` check out nothing. Without a Projects
 * client, or for a project that is gone, a job keeps its checkout.
 */
export async function loadNoDefaultCheckout(params: {
  projectId: string;
  projects?: Pick<ProjectsModuleClient, 'getProjectById' | 'getProjectAccessPolicy'> | undefined;
  integrations?: Pick<IntegrationsModuleClient, 'listSourceControlConnectionIds'> | undefined;
}): Promise<boolean> {
  if (params.projects === undefined) return false;
  const {project} = await params.projects.getProjectById({projectId: params.projectId});
  if (project === null || project === undefined) return false;
  const defaults = await loadProjectCheckoutDefaults({
    project,
    projects: params.projects,
    integrations: params.integrations,
  });
  return defaults !== null && defaults.defaultCheckout === null;
}

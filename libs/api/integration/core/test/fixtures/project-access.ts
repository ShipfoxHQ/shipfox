import type {ProjectAccessPolicy} from '@shipfox/api-projects-dto';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';

/** A linked project with access to every connection and repository. */
export function projectAccessPolicy(
  overrides: Partial<ProjectAccessPolicy> = {},
): ProjectAccessPolicy {
  return {
    projectId: crypto.randomUUID(),
    configSource: {
      managed: false,
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'test:config',
      lookupName: 'acme/config',
    },
    connections: 'all',
    ...overrides,
  };
}

/**
 * A Projects client that answers access reads from `policies`. A project it does not know
 * fails like a deleted one, and `all` answers every project with full access.
 */
export function createProjectAccessClient(
  policies: readonly ProjectAccessPolicy[] | 'all',
): ProjectsModuleClient {
  const getProjectAccessPolicy: ProjectsModuleClient['getProjectAccessPolicy'] = ({projectId}) => {
    const policy =
      policies === 'all'
        ? projectAccessPolicy({projectId})
        : policies.find((candidate) => candidate.projectId === projectId);
    if (policy === undefined) {
      throw createInterModuleKnownError(
        projectsInterModuleContract.methods.getProjectAccessPolicy,
        'project-not-found',
        {projectId},
      );
    }
    return Promise.resolve({policy});
  };
  return {getProjectAccessPolicy} as unknown as ProjectsModuleClient;
}

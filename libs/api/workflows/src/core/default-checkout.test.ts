import type {ProjectAccessPolicy} from '@shipfox/api-projects-dto';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {projectFactory} from '#test/factories/project.js';
import {loadNoDefaultCheckout, loadProjectCheckoutDefaults} from './default-checkout.js';

const codeConnectionId = crypto.randomUUID();
const app = {kind: 'repository', externalId: 'github:77', lookupName: 'acme/app'};

function managedProject() {
  return projectFactory.build({sourceExternalRepositoryId: `managed-vcs:${crypto.randomUUID()}`});
}

function policyFor(
  project: ReturnType<typeof managedProject>,
  connections: ProjectAccessPolicy['connections'],
): ProjectAccessPolicy {
  return {
    projectId: project.id,
    configSource: {
      managed: true,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      lookupName: null,
    },
    connections,
  };
}

function clients(project: ReturnType<typeof managedProject>, policy?: ProjectAccessPolicy) {
  return {
    projects: {
      getProjectById: vi.fn().mockResolvedValue({project}),
      getProjectAccessPolicy: vi.fn().mockImplementation(() => {
        if (policy === undefined) {
          throw createInterModuleKnownError(
            projectsInterModuleContract.methods.getProjectAccessPolicy,
            'project-not-found',
            {projectId: project.id},
          );
        }
        return Promise.resolve({policy});
      }),
    },
    integrations: {
      listSourceControlConnectionIds: vi
        .fn()
        .mockResolvedValue({connectionIds: [codeConnectionId]}),
    },
  };
}

describe('loadProjectCheckoutDefaults', () => {
  it('defaults a linked project to its config repository without reading its access', async () => {
    const project = projectFactory.build();
    const {projects, integrations} = clients(managedProject());

    const defaults = await loadProjectCheckoutDefaults({project, projects, integrations});

    expect(defaults).toEqual({
      defaultCheckout: {
        connectionId: project.sourceConnectionId,
        externalRepositoryId: project.sourceExternalRepositoryId,
      },
      defaultConnectionId: project.sourceConnectionId,
    });
    expect(projects.getProjectAccessPolicy).not.toHaveBeenCalled();
  });

  it('defaults a managed project to the one repository its access names', async () => {
    const project = managedProject();
    const {projects, integrations} = clients(
      project,
      policyFor(project, [{connectionId: codeConnectionId, resources: [app]}]),
    );

    await expect(loadProjectCheckoutDefaults({project, projects, integrations})).resolves.toEqual({
      defaultCheckout: {connectionId: codeConnectionId, externalRepositoryId: app.externalId},
      defaultConnectionId: codeConnectionId,
    });
  });

  it('has a default connection but no checkout for all repositories', async () => {
    const project = managedProject();
    const {projects, integrations} = clients(
      project,
      policyFor(project, [{connectionId: codeConnectionId, resources: 'all'}]),
    );

    await expect(loadProjectCheckoutDefaults({project, projects, integrations})).resolves.toEqual({
      defaultCheckout: null,
      defaultConnectionId: codeConnectionId,
    });
  });

  it('is null for a project that is gone', async () => {
    const project = managedProject();
    const {projects, integrations} = clients(project);

    await expect(
      loadProjectCheckoutDefaults({project, projects, integrations}),
    ).resolves.toBeNull();
  });
});

describe('loadNoDefaultCheckout', () => {
  it('is false for a linked project', async () => {
    const project = projectFactory.build();
    const {projects, integrations} = clients(project as never);

    await expect(
      loadNoDefaultCheckout({projectId: project.id, projects, integrations}),
    ).resolves.toBe(false);
  });

  it('is true for a managed project with access to all repositories', async () => {
    const project = managedProject();
    const {projects, integrations} = clients(project, policyFor(project, 'all'));

    await expect(
      loadNoDefaultCheckout({projectId: project.id, projects, integrations}),
    ).resolves.toBe(true);
  });

  it('is false for a managed project whose access names one repository', async () => {
    const project = managedProject();
    const {projects, integrations} = clients(
      project,
      policyFor(project, [{connectionId: codeConnectionId, resources: [app]}]),
    );

    await expect(
      loadNoDefaultCheckout({projectId: project.id, projects, integrations}),
    ).resolves.toBe(false);
  });

  it('is true for a managed project when no Integrations client is available', async () => {
    const project = managedProject();
    const {projects} = clients(
      project,
      policyFor(project, [{connectionId: codeConnectionId, resources: [app]}]),
    );

    await expect(loadNoDefaultCheckout({projectId: project.id, projects})).resolves.toBe(true);
  });

  it('is false without a Projects client', async () => {
    await expect(loadNoDefaultCheckout({projectId: crypto.randomUUID()})).resolves.toBe(false);
  });
});

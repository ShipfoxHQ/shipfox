import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import * as workflowRuns from '#db/workflow-runs.js';
import {jobFactory} from '#test/factories/job.js';
import {projectFactory} from '#test/factories/project.js';
import {createJobCheckoutSpec, resolveCheckoutIntent} from './checkout.js';
import {
  CheckoutIntentUnresolvedError,
  JobNotFoundError,
  WorkflowRunNotFoundError,
} from './errors.js';

const getProjectById = vi.fn();
const projects = {getProjectById} as Pick<ProjectsModuleClient, 'getProjectById'>;

describe('resolveCheckoutIntent', () => {
  it('resolves connection + repo from the project, using the project workspace', async () => {
    const project = projectFactory.build();
    getProjectById.mockResolvedValue({project});
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});

    const intent = await resolveCheckoutIntent(job.id, projects as ProjectsModuleClient);

    expect(intent).toEqual({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      persistCredentials: true,
      permissions: {contents: 'read'},
    });
  });

  it('throws JobNotFoundError for an unknown job', async () => {
    const act = resolveCheckoutIntent(crypto.randomUUID(), projects as ProjectsModuleClient);

    await expect(act).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it('resolves the checkout target while the parent job projection is still pending', async () => {
    const project = projectFactory.build();
    getProjectById.mockResolvedValue({project});
    const job = await jobFactory.create(
      {},
      {transient: {projectId: project.id, status: 'pending'}},
    );

    const intent = await resolveCheckoutIntent(job.id, projects as ProjectsModuleClient);

    expect(intent.connectionId).toBe(project.sourceConnectionId);
  });

  it('throws WorkflowRunNotFoundError when the run is missing', async () => {
    const project = projectFactory.build();
    getProjectById.mockResolvedValue({project});
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    vi.spyOn(workflowRuns, 'getWorkflowRunByAttemptId').mockResolvedValue(undefined);

    const act = resolveCheckoutIntent(job.id, projects as ProjectsModuleClient);

    await expect(act).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
  });

  it('throws CheckoutIntentUnresolvedError when the project is missing', async () => {
    const project = projectFactory.build();
    getProjectById.mockResolvedValue({project: null});
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});

    const act = resolveCheckoutIntent(job.id, projects as ProjectsModuleClient);

    await expect(act).rejects.toBeInstanceOf(CheckoutIntentUnresolvedError);
  });
});

describe('createJobCheckoutSpec', () => {
  it('passes the resolved intent without a ref to the service', async () => {
    const project = projectFactory.build();
    getProjectById.mockResolvedValue({project});
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    const spec = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main'};
    const createCheckoutSpec = vi.fn().mockResolvedValue(spec);
    const integrations = {createCheckoutSpec} as Pick<
      IntegrationsModuleClient,
      'createCheckoutSpec'
    >;

    const result = await createJobCheckoutSpec({
      jobId: job.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    expect(result).toEqual({spec, persistCredentials: true});
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      permissions: {contents: 'read'},
    });
  });

  it('passes requested write contents permission to the service', async () => {
    const project = projectFactory.build();
    getProjectById.mockResolvedValue({project});
    const job = await jobFactory.create(
      {},
      {transient: {projectId: project.id, checkout: {permissions: {contents: 'write'}}}},
    );
    const spec = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main'};
    const createCheckoutSpec = vi.fn().mockResolvedValue(spec);
    const integrations = {createCheckoutSpec} as Pick<
      IntegrationsModuleClient,
      'createCheckoutSpec'
    >;

    await createJobCheckoutSpec({
      jobId: job.id,
      integrations: integrations as IntegrationsModuleClient,
      projects: projects as ProjectsModuleClient,
    });

    expect(createCheckoutSpec).toHaveBeenCalledWith(
      expect.objectContaining({permissions: {contents: 'write'}}),
    );
  });
});

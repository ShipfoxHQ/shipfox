import type {CheckoutSpec, IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {getProjectById} from '@shipfox/api-projects';
import * as workflowRuns from '#db/workflow-runs.js';
import {jobFactory} from '#test/factories/job.js';
import {projectFactory} from '#test/factories/project.js';
import {createJobCheckoutSpec, resolveCheckoutIntent} from './checkout.js';
import {
  CheckoutIntentUnresolvedError,
  JobNotActiveError,
  JobNotFoundError,
  WorkflowRunNotFoundError,
} from './errors.js';

vi.mock('@shipfox/api-projects', () => ({getProjectById: vi.fn()}));
const mockGetProjectById = vi.mocked(getProjectById);

describe('resolveCheckoutIntent', () => {
  it('resolves connection + repo from the project, using the project workspace', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});

    const intent = await resolveCheckoutIntent(job.id);

    expect(intent).toEqual({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
  });

  it('throws JobNotFoundError for an unknown job', async () => {
    const act = resolveCheckoutIntent(crypto.randomUUID());

    await expect(act).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it.each([
    'succeeded',
    'failed',
    'cancelled',
  ] as const)('throws JobNotActiveError when the job is %s (terminal)', async (status) => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id, status}});

    const act = resolveCheckoutIntent(job.id);

    await expect(act).rejects.toBeInstanceOf(JobNotActiveError);
  });

  it.each([
    'pending',
    'ready',
    'awaiting_manual',
  ] as const)('throws JobNotActiveError when the job is %s (not yet running)', async (status) => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id, status}});

    const act = resolveCheckoutIntent(job.id);

    await expect(act).rejects.toBeInstanceOf(JobNotActiveError);
  });

  it('throws WorkflowRunNotFoundError when the run is missing', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    vi.spyOn(workflowRuns, 'getWorkflowRunById').mockResolvedValue(undefined);

    const act = resolveCheckoutIntent(job.id);

    await expect(act).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
  });

  it('throws CheckoutIntentUnresolvedError when the project is missing', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(undefined);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});

    const act = resolveCheckoutIntent(job.id);

    await expect(act).rejects.toBeInstanceOf(CheckoutIntentUnresolvedError);
  });
});

describe('createJobCheckoutSpec', () => {
  it('passes the resolved intent and an undefined ref to the service', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    const spec: CheckoutSpec = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main'};
    const createCheckoutSpec = vi.fn().mockResolvedValue(spec);
    const sourceControl = {createCheckoutSpec} as unknown as IntegrationSourceControlService;

    const result = await createJobCheckoutSpec({jobId: job.id, sourceControl});

    expect(result).toBe(spec);
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      ref: undefined,
    });
  });
});

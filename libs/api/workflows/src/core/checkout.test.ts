import type {CheckoutSpec, IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {getProjectById} from '@shipfox/api-projects';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import * as workflowRuns from '#db/workflow-runs.js';
import {jobFactory} from '#test/factories/job.js';
import {projectFactory} from '#test/factories/project.js';
import {createJobCheckoutSpec, resolveCheckoutIntent} from './checkout.js';
import {
  CheckoutIntentUnresolvedError,
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
      permissions: {contents: 'read'},
    });
  });

  it('throws JobNotFoundError for an unknown job', async () => {
    const act = resolveCheckoutIntent(crypto.randomUUID());

    await expect(act).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it('resolves the checkout target while the parent job projection is still pending', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create(
      {},
      {transient: {projectId: project.id, status: 'pending'}},
    );

    const intent = await resolveCheckoutIntent(job.id);

    expect(intent.connectionId).toBe(project.sourceConnectionId);
  });

  it('throws WorkflowRunNotFoundError when the run is missing', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    vi.spyOn(workflowRuns, 'getWorkflowRunByAttemptId').mockResolvedValue(undefined);

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
      permissions: {contents: 'read'},
    });
  });

  it('passes the persisted job checkout permissions to the service', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    await db()
      .update(jobs)
      .set({checkout: {permissions: {contents: 'write'}, persistCredentials: true}})
      .where(eq(jobs.id, job.id));
    const spec: CheckoutSpec = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main'};
    const createCheckoutSpec = vi.fn().mockResolvedValue(spec);
    const sourceControl = {createCheckoutSpec} as unknown as IntegrationSourceControlService;

    await createJobCheckoutSpec({jobId: job.id, sourceControl});

    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      ref: undefined,
      permissions: {contents: 'write'},
    });
  });

  it('defaults null checkout rows to read permissions', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    await db().update(jobs).set({checkout: null}).where(eq(jobs.id, job.id));
    const spec: CheckoutSpec = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main'};
    const createCheckoutSpec = vi.fn().mockResolvedValue(spec);
    const sourceControl = {createCheckoutSpec} as unknown as IntegrationSourceControlService;

    await createJobCheckoutSpec({jobId: job.id, sourceControl});

    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      ref: undefined,
      permissions: {contents: 'read'},
    });
  });

  it('fails malformed checkout rows safe to read permissions', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    await db()
      .update(jobs)
      .set({checkout: {permissions: {contents: 'admin'}, persistCredentials: true} as never})
      .where(eq(jobs.id, job.id));
    const spec: CheckoutSpec = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main'};
    const createCheckoutSpec = vi.fn().mockResolvedValue(spec);
    const sourceControl = {createCheckoutSpec} as unknown as IntegrationSourceControlService;

    await createJobCheckoutSpec({jobId: job.id, sourceControl});

    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      ref: undefined,
      permissions: {contents: 'read'},
    });
  });
});

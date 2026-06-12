import type {CheckoutSpec, IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {getProjectById} from '@shipfox/api-projects';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {getJobsByRunId} from '#db/workflow-runs.js';
import {workflowRunFactory} from '#test/factories/workflow-run.js';
import {createJobCheckoutSpec, resolveCheckoutIntent} from './checkout.js';
import {CheckoutIntentUnresolvedError, JobNotActiveError, JobNotFoundError} from './errors.js';

vi.mock('@shipfox/api-projects', () => ({getProjectById: vi.fn()}));
const mockGetProjectById = vi.mocked(getProjectById);

interface ProjectRow {
  id: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

function buildProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    sourceConnectionId: crypto.randomUUID(),
    sourceExternalRepositoryId: 'acme/repo',
    name: 'Project',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function arrangeJob(projectId: string): Promise<string> {
  const run = await workflowRunFactory.create({projectId});
  const runJobs = await getJobsByRunId(run.id);
  return runJobs[0]?.id as string;
}

describe('resolveCheckoutIntent', () => {
  it('resolves connection + repo from the project, using the project workspace', async () => {
    const projectId = crypto.randomUUID();
    const project = buildProject({id: projectId});
    mockGetProjectById.mockResolvedValue(project);
    const jobId = await arrangeJob(projectId);

    const intent = await resolveCheckoutIntent(jobId);

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

  it('throws JobNotActiveError when the job is terminal', async () => {
    const projectId = crypto.randomUUID();
    mockGetProjectById.mockResolvedValue(buildProject({id: projectId}));
    const jobId = await arrangeJob(projectId);
    await db().update(jobs).set({status: 'cancelled'}).where(eq(jobs.id, jobId));

    const act = resolveCheckoutIntent(jobId);

    await expect(act).rejects.toBeInstanceOf(JobNotActiveError);
  });

  it('throws CheckoutIntentUnresolvedError when the project is missing', async () => {
    const projectId = crypto.randomUUID();
    mockGetProjectById.mockResolvedValue(undefined);
    const jobId = await arrangeJob(projectId);

    const act = resolveCheckoutIntent(jobId);

    await expect(act).rejects.toBeInstanceOf(CheckoutIntentUnresolvedError);
  });
});

describe('createJobCheckoutSpec', () => {
  it('passes the resolved intent and an undefined ref to the service', async () => {
    const projectId = crypto.randomUUID();
    const project = buildProject({id: projectId});
    mockGetProjectById.mockResolvedValue(project);
    const jobId = await arrangeJob(projectId);
    const spec: CheckoutSpec = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main'};
    const createCheckoutSpec = vi.fn().mockResolvedValue(spec);
    const sourceControl = {createCheckoutSpec} as unknown as IntegrationSourceControlService;

    const result = await createJobCheckoutSpec({jobId, sourceControl});

    expect(result).toBe(spec);
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      ref: undefined,
    });
  });
});

import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import {
  type CheckoutSpec,
  IntegrationConnectionInactiveError,
  IntegrationProviderError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import {getProjectById} from '@shipfox/api-projects';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import {pino} from 'pino';
import {setSourceControl} from '#core/source-control.js';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {getJobsByRunId} from '#db/workflow-runs.js';
import {workflowRunFactory} from '#test/factories/workflow-run.js';
import {mintLeaseToken} from '#test/fixtures/lease-token.js';
import {leaseTokenRouteGroup} from './index.js';

vi.mock('@shipfox/api-projects', () => ({getProjectById: vi.fn()}));
const mockGetProjectById = vi.mocked(getProjectById);

const URL = '/runs/jobs/current/checkout-token';

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

async function arrangeJob(projectId: string): Promise<{jobId: string; runId: string}> {
  const run = await workflowRunFactory.create({projectId});
  const runJobs = await getJobsByRunId(run.id);
  return {jobId: runJobs[0]?.id as string, runId: run.id};
}

const githubSpec = (token: string): CheckoutSpec => ({
  repositoryUrl: 'https://github.com/acme/repo.git',
  ref: 'main',
  credentials: {username: 'x-access-token', token, expiresAt: new Date('2026-06-10T12:00:00.000Z')},
});

describe('POST /runs/jobs/current/checkout-token', () => {
  let app: FastifyInstance;
  const createCheckoutSpec = vi.fn();
  const logLines: string[] = [];

  beforeAll(async () => {
    const capturingLogger = pino(
      {level: 'trace'},
      {write: (line: string) => void logLines.push(line)},
    );
    setSourceControl({createCheckoutSpec} as unknown as IntegrationSourceControlService);
    app = await createApp({
      auth: [createLeaseTokenAuthMethod()],
      routes: [leaseTokenRouteGroup],
      swagger: false,
      fastifyOptions: {loggerInstance: capturingLogger},
    });
    await app.ready();
  });

  beforeEach(() => {
    createCheckoutSpec.mockReset();
    mockGetProjectById.mockReset();
    logLines.length = 0;
  });

  afterAll(async () => {
    await closeApp();
    setSourceControl(undefined as unknown as IntegrationSourceControlService);
  });

  describe('lease-token auth', () => {
    test('rejects a request without an Authorization header', async () => {
      const res = await app.inject({method: 'POST', url: URL});

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects an expired token', async () => {
      const token = await mintLeaseToken({jobId: crypto.randomUUID(), expiresIn: '-1s'});

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
    });

    test('rejects a token with the wrong audience', async () => {
      const token = await mintLeaseToken({jobId: crypto.randomUUID(), audience: 'user-session'});

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
    });
  });

  test('returns basic auth for a GitHub-style spec with credentials', async () => {
    const project = buildProject();
    mockGetProjectById.mockResolvedValue(project);
    const {jobId} = await arrangeJob(project.id);
    createCheckoutSpec.mockResolvedValue(githubSpec('ghs-secret-token'));
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      repository_url: 'https://github.com/acme/repo.git',
      ref: 'main',
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token: 'ghs-secret-token',
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
  });

  test('omits auth for a credential-free (debug) spec', async () => {
    const project = buildProject();
    mockGetProjectById.mockResolvedValue(project);
    const {jobId} = await arrangeJob(project.id);
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://example.com/acme/repo.git',
      ref: 'trunk',
    } satisfies CheckoutSpec);
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      repository_url: 'https://example.com/acme/repo.git',
      ref: 'trunk',
    });
  });

  test('returns 404 for a valid token naming an unknown job', async () => {
    const token = await mintLeaseToken({jobId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('job-not-found');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('returns 409 and mints nothing when the job is terminal', async () => {
    const project = buildProject();
    mockGetProjectById.mockResolvedValue(project);
    const {jobId} = await arrangeJob(project.id);
    await db().update(jobs).set({status: 'cancelled'}).where(eq(jobs.id, jobId));
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('job-not-active');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('ignores a hostile runId claim and resolves via the job row', async () => {
    const projectA = buildProject();
    const projectB = buildProject();
    const projectsById = new Map([
      [projectA.id, projectA],
      [projectB.id, projectB],
    ]);
    mockGetProjectById.mockImplementation((id: string) => Promise.resolve(projectsById.get(id)));
    const jobA = await arrangeJob(projectA.id);
    const runB = await arrangeJob(projectB.id);
    createCheckoutSpec.mockResolvedValue(githubSpec('token'));
    // Lease names job A but lies that the run is run B.
    const token = await mintLeaseToken({jobId: jobA.jobId, runId: runB.runId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(createCheckoutSpec).toHaveBeenCalledWith(
      expect.objectContaining({connectionId: projectA.sourceConnectionId}),
    );
    expect(createCheckoutSpec).not.toHaveBeenCalledWith(
      expect.objectContaining({connectionId: projectB.sourceConnectionId}),
    );
  });

  test('passes the project workspace, never the lease workspace claim', async () => {
    const project = buildProject();
    mockGetProjectById.mockResolvedValue(project);
    const {jobId} = await arrangeJob(project.id);
    createCheckoutSpec.mockResolvedValue(githubSpec('token'));
    const token = await mintLeaseToken({jobId, workspaceId: crypto.randomUUID()});

    await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});

    expect(createCheckoutSpec).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: project.workspaceId}),
    );
  });

  test('returns 404 when the run has no project linkage', async () => {
    const projectId = crypto.randomUUID();
    mockGetProjectById.mockResolvedValue(undefined);
    const {jobId} = await arrangeJob(projectId);
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('checkout-unavailable');
  });

  test('maps a rate-limited provider error to 429 with retry_after_seconds', async () => {
    const project = buildProject();
    mockGetProjectById.mockResolvedValue(project);
    const {jobId} = await arrangeJob(project.id);
    createCheckoutSpec.mockRejectedValue(
      new IntegrationProviderError('rate-limited', 'slow down', 60),
    );
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate-limited');
    expect(res.json().details.retry_after_seconds).toBe(60);
  });

  test('maps an inactive connection error to 422', async () => {
    const project = buildProject();
    mockGetProjectById.mockResolvedValue(project);
    const {jobId} = await arrangeJob(project.id);
    createCheckoutSpec.mockRejectedValue(
      new IntegrationConnectionInactiveError(project.sourceConnectionId),
    );
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(422);
  });

  test('never writes the minted token to a log line', async () => {
    const project = buildProject();
    mockGetProjectById.mockResolvedValue(project);
    const {jobId} = await arrangeJob(project.id);
    const secret = 'ghs-super-secret-token-value';
    createCheckoutSpec.mockResolvedValue(githubSpec(secret));
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().auth.token).toBe(secret);
    expect(logLines.join('\n')).not.toContain(secret);
  });
});

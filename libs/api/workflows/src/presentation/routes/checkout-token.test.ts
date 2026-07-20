import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import {
  type CheckoutSpec,
  IntegrationCheckoutUnsupportedError,
  IntegrationConnectionInactiveError,
  IntegrationProviderError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {createCapturingLogger} from '@shipfox/node-log/test';
import {clearSourceControl, setSourceControl} from '#core/source-control.js';
import {jobFactory} from '#test/factories/job.js';
import {projectFactory} from '#test/factories/project.js';
import {mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {agentTestClient} from '#test/fixtures/agent-inter-module.js';
import {mintLeaseToken} from '#test/fixtures/lease-token.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';

const mockGetProjectById = vi.fn();
const projects = {
  getProjectById: async ({projectId}: {projectId: string}) => ({
    project: await mockGetProjectById(projectId),
  }),
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

const URL = '/runs/jobs/current/checkout-token';

const githubSpec = (token: string): CheckoutSpec => ({
  repositoryUrl: 'https://github.com/acme/repo.git',
  ref: 'main',
  credentials: {username: 'x-access-token', token, expiresAt: new Date('2026-06-10T12:00:00.000Z')},
});

describe('POST /runs/jobs/current/checkout-token', () => {
  let app: FastifyInstance;
  const createCheckoutSpec = vi.fn();
  const {logger, lines: logLines, clear: clearLogLines} = createCapturingLogger();

  beforeAll(async () => {
    setSourceControl({createCheckoutSpec} as unknown as IntegrationSourceControlService);
    app = await createApp({
      auth: [createLeaseTokenAuthMethod()],
      routes: [
        createLeaseTokenRouteGroup({agent: agentTestClient, projects, runners: runnersTestClient}),
      ],
      swagger: false,
      fastifyOptions: {loggerInstance: logger},
    });
    await app.ready();
  });

  beforeEach(() => {
    createCheckoutSpec.mockReset();
    mockGetProjectById.mockReset();
    clearLogLines();
  });

  afterAll(async () => {
    await closeApp();
    clearSourceControl();
  });

  describe('lease-token auth', () => {
    test('rejects a request without an Authorization header', async () => {
      const res = await app.inject({method: 'POST', url: URL});

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects an expired token', async () => {
      const token = await mintLeaseToken({
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        expiresIn: '-1s',
      });

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
    });

    test('rejects a token with the wrong audience', async () => {
      const token = await mintLeaseToken({
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        audience: 'user-session',
      });

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
    });
  });

  test('returns basic auth for a GitHub-style spec with credentials', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockResolvedValue(githubSpec('ghs-secret-token'));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      repository_url: 'https://github.com/acme/repo.git',
      ref: 'main',
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token: 'ghs-secret-token',
        expires_at: '2026-06-10T12:00:00.000Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });
  });

  test('omits auth for a credential-free (debug) spec', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://example.com/acme/repo.git',
      ref: 'trunk',
    } satisfies CheckoutSpec);
    const token = await mintActiveLeaseToken({jobId: job.id});

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

  test('returns 404 for a token without an active lease', async () => {
    const token = await mintLeaseToken({
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test.each([
    'succeeded',
    'failed',
    'cancelled',
    'skipped',
  ] as const)('returns 404 and mints nothing without an active lease for %s job', async (status) => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id, status}});
    const token = await mintLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('returns checkout credentials while the parent job projection is still pending', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create(
      {},
      {transient: {projectId: project.id, status: 'pending'}},
    );
    createCheckoutSpec.mockResolvedValue(githubSpec('token'));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(createCheckoutSpec).toHaveBeenCalledWith(
      expect.objectContaining({connectionId: project.sourceConnectionId}),
    );
  });

  test('ignores a hostile workflowRunAttemptId claim and resolves via the job row', async () => {
    const projectA = projectFactory.build();
    const projectB = projectFactory.build();
    const projectsById = new Map([
      [projectA.id, projectA],
      [projectB.id, projectB],
    ]);
    mockGetProjectById.mockImplementation((id: string) => Promise.resolve(projectsById.get(id)));
    const jobA = await jobFactory.create({}, {transient: {projectId: projectA.id}});
    const jobB = await jobFactory.create({}, {transient: {projectId: projectB.id}});
    createCheckoutSpec.mockResolvedValue(githubSpec('token'));
    const token = await mintActiveLeaseToken({
      jobId: jobA.id,
      token: {workflowRunAttemptId: jobB.workflowRunAttemptId},
    });

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
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockResolvedValue(githubSpec('token'));
    const token = await mintActiveLeaseToken({
      jobId: job.id,
      token: {workspaceId: crypto.randomUUID()},
    });

    await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});

    expect(createCheckoutSpec).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: project.workspaceId}),
    );
  });

  test('returns 404 when the run has no project linkage', async () => {
    mockGetProjectById.mockResolvedValue(undefined);
    const project = {id: crypto.randomUUID(), workspaceId: crypto.randomUUID()};
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('checkout-unavailable');
  });

  test('maps a rate-limited provider error to 429 with retry_after_seconds', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockRejectedValue(
      new IntegrationProviderError('rate-limited', 'slow down', 60),
    );
    const token = await mintActiveLeaseToken({jobId: job.id});

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
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockRejectedValue(
      new IntegrationConnectionInactiveError(project.sourceConnectionId),
    );
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(422);
  });

  test('maps an unsupported-checkout provider error to 422', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockRejectedValue(new IntegrationCheckoutUnsupportedError('github'));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-checkout-unsupported');
  });

  test('surfaces an unexpected provider error as a 500 server-error', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockRejectedValue(new Error('unexpected provider failure'));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('server-error');
  });

  test('never writes the minted token to a log line', async () => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    const secret = 'ghs-super-secret-token-value';
    createCheckoutSpec.mockResolvedValue(githubSpec(secret));
    const token = await mintActiveLeaseToken({jobId: job.id});

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

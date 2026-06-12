import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import {
  type CheckoutSpec,
  IntegrationCheckoutUnsupportedError,
  IntegrationConnectionInactiveError,
  IntegrationProviderError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import {getProjectById} from '@shipfox/api-projects';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {pino} from 'pino';
import {clearSourceControl, setSourceControl} from '#core/source-control.js';
import {jobFactory} from '#test/factories/job.js';
import {projectFactory} from '#test/factories/project.js';
import {mintLeaseToken} from '#test/fixtures/lease-token.js';
import {leaseTokenRouteGroup} from './index.js';

vi.mock('@shipfox/api-projects', () => ({getProjectById: vi.fn()}));
const mockGetProjectById = vi.mocked(getProjectById);

const URL = '/runs/jobs/current/checkout-token';

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
    clearSourceControl();
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
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id}});
    createCheckoutSpec.mockResolvedValue(githubSpec('ghs-secret-token'));
    const token = await mintLeaseToken({jobId: job.id});

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
    const token = await mintLeaseToken({jobId: job.id});

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

  test.each([
    'succeeded',
    'failed',
    'cancelled',
  ] as const)('returns 409 and mints nothing when the job is %s (terminal)', async (status) => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id, status}});
    const token = await mintLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('job-not-active');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test.each([
    'pending',
    'awaiting_manual',
  ] as const)('returns 409 and mints nothing when the job is %s (not yet running)', async (status) => {
    const project = projectFactory.build();
    mockGetProjectById.mockResolvedValue(project);
    const job = await jobFactory.create({}, {transient: {projectId: project.id, status}});
    const token = await mintLeaseToken({jobId: job.id});

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
    // Lease names job A but lies that the run is job B's run.
    const token = await mintLeaseToken({jobId: jobA.id, runId: jobB.runId});

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
    const token = await mintLeaseToken({jobId: job.id, workspaceId: crypto.randomUUID()});

    await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});

    expect(createCheckoutSpec).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: project.workspaceId}),
    );
  });

  test('returns 404 when the run has no project linkage', async () => {
    mockGetProjectById.mockResolvedValue(undefined);
    const job = await jobFactory.create({}, {transient: {projectId: crypto.randomUUID()}});
    const token = await mintLeaseToken({jobId: job.id});

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
    const token = await mintLeaseToken({jobId: job.id});

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
    const token = await mintLeaseToken({jobId: job.id});

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
    const token = await mintLeaseToken({jobId: job.id});

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
    const token = await mintLeaseToken({jobId: job.id});

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
    const token = await mintLeaseToken({jobId: job.id});

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

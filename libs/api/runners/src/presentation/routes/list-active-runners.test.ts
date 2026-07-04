import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
  buildUserContext,
  requireWorkspaceAccess,
  setUserContext,
} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {provisionedRunners} from '#db/schema/provisioned-runners.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {runnerSessionFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

vi.mock('@shipfox/api-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/api-auth-context')>();
  return {...actual, requireWorkspaceAccess: vi.fn()};
});

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: [{workspaceId: 'workspace-from-auth', role: 'admin'}],
      }),
    );
    return Promise.resolve();
  },
};

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('GET /workspaces/:workspaceId/runners/active', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    vi.mocked(requireWorkspaceAccess).mockReturnValue({
      workspaceId,
      userId: 'user-1',
      role: 'admin',
    });
    app = await createApp({
      auth: [
        fakeUserAuth,
        passthroughAuth(AUTH_RUNNER_REGISTRATION_TOKEN),
        passthroughAuth(AUTH_RUNNER_SESSION),
        passthroughAuth(AUTH_LEASED_JOB),
        passthroughAuth(AUTH_PROVISIONER_TOKEN),
      ],
      routes: runnerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('returns active provisioned runners merged with running jobs by runner session', async () => {
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    const runnerSessionId = runnerSession.id;
    await db()
      .insert(provisionedRunners)
      .values({
        workspaceId,
        provisionerId: crypto.randomUUID(),
        provisionedRunnerId: 'provisioned-runner-1',
        labels: ['linux'],
        state: 'running',
        runnerSessionId,
        providerKind: 'docker',
        reportedAt: new Date(),
      });
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
      });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/runners/active`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners).toEqual([
      expect.objectContaining({
        runner_session_id: runnerSessionId,
        provisioned_runner_id: 'provisioned-runner-1',
        state: 'busy',
        labels: ['linux'],
      }),
    ]);
  });

  it('returns every active job for the same runner session', async () => {
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    const runnerSessionId = runnerSession.id;
    const firstJobId = crypto.randomUUID();
    const secondJobId = crypto.randomUUID();
    await db()
      .insert(provisionedRunners)
      .values({
        workspaceId,
        provisionerId: crypto.randomUUID(),
        provisionedRunnerId: 'provisioned-runner-1',
        labels: ['linux'],
        state: 'running',
        runnerSessionId,
        providerKind: 'docker',
        reportedAt: new Date(),
      });
    await db()
      .insert(runningJobExecutions)
      .values([
        {
          workspaceId,
          jobId: firstJobId,
          jobExecutionId: crypto.randomUUID(),
          workflowRunId: crypto.randomUUID(),
          workflowRunAttemptId: crypto.randomUUID(),
          projectId: crypto.randomUUID(),
          runnerSessionId,
          requiredLabels: ['linux'],
          runnerLabels: ['linux'],
        },
        {
          workspaceId,
          jobId: secondJobId,
          jobExecutionId: crypto.randomUUID(),
          workflowRunId: crypto.randomUUID(),
          workflowRunAttemptId: crypto.randomUUID(),
          projectId: crypto.randomUUID(),
          runnerSessionId,
          requiredLabels: ['linux'],
          runnerLabels: ['linux'],
        },
      ]);

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/runners/active`,
      headers: {authorization: 'Bearer user'},
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.runners).toHaveLength(2);
    expect(body.runners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runner_session_id: runnerSessionId,
          provisioned_runner_id: 'provisioned-runner-1',
          state: 'busy',
          job_id: firstJobId,
        }),
        expect.objectContaining({
          runner_session_id: runnerSessionId,
          provisioned_runner_id: 'provisioned-runner-1',
          state: 'busy',
          job_id: secondJobId,
        }),
      ]),
    );
  });

  it('merges active jobs by provisioned-runner link when the session id is not reported', async () => {
    const provisionerId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    const runnerSessionId = runnerSession.id;
    const jobId = crypto.randomUUID();
    await db()
      .insert(provisionedRunners)
      .values({
        workspaceId,
        provisionerId,
        provisionedRunnerId: 'provisioned-runner-1',
        labels: ['linux'],
        state: 'running',
        runnerSessionId: null,
        providerKind: 'docker',
        reportedAt: new Date(),
      });
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        jobId,
        jobExecutionId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId,
        provisionerId,
        provisionedRunnerId: 'provisioned-runner-1',
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
      });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/runners/active`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners).toEqual([
      expect.objectContaining({
        runner_session_id: runnerSessionId,
        provisioned_runner_id: 'provisioned-runner-1',
        provisioner_id: provisionerId,
        state: 'busy',
        job_id: jobId,
      }),
    ]);
  });

  it('surfaces the job link for a busy runner without an active provisioned-runner row', async () => {
    const provisionerId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    const runnerSessionId = runnerSession.id;
    const jobId = crypto.randomUUID();
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        jobId,
        jobExecutionId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId,
        provisionerId,
        provisionedRunnerId: 'provisioned-runner-1',
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
      });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/runners/active`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners).toEqual([
      expect.objectContaining({
        runner_session_id: runnerSessionId,
        provisioned_runner_id: 'provisioned-runner-1',
        provisioner_id: provisionerId,
        state: 'busy',
        job_id: jobId,
      }),
    ]);
  });

  it('keeps a provisioned runner visible when its session fallback job was already merged', async () => {
    const provisionerId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    const runnerSessionId = runnerSession.id;
    const jobId = crypto.randomUUID();
    const older = new Date(Date.now() - 1000);
    const newer = new Date();
    await db()
      .insert(provisionedRunners)
      .values([
        {
          workspaceId,
          provisionerId,
          provisionedRunnerId: 'provisioned-runner-b',
          labels: ['linux'],
          state: 'running',
          runnerSessionId,
          providerKind: 'docker',
          reportedAt: older,
          updatedAt: older,
        },
        {
          workspaceId,
          provisionerId,
          provisionedRunnerId: 'provisioned-runner-a',
          labels: ['linux'],
          state: 'running',
          runnerSessionId: null,
          providerKind: 'docker',
          reportedAt: newer,
          updatedAt: newer,
        },
      ]);
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        jobId,
        jobExecutionId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId,
        provisionerId,
        provisionedRunnerId: 'provisioned-runner-a',
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
      });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/runners/active`,
      headers: {authorization: 'Bearer user'},
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.runners).toHaveLength(2);
    expect(body.runners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runner_session_id: runnerSessionId,
          provisioned_runner_id: 'provisioned-runner-a',
          state: 'busy',
          job_id: jobId,
        }),
        expect.objectContaining({
          runner_session_id: runnerSessionId,
          provisioned_runner_id: 'provisioned-runner-b',
          state: 'running',
          job_id: null,
        }),
      ]),
    );
  });

  it('returns 403 when the user is not a workspace member', async () => {
    vi.mocked(requireWorkspaceAccess).mockImplementationOnce(() => {
      throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
    });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/runners/active`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
  });
});

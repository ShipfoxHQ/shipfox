import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_RUNNER_TOKEN,
  AUTH_USER,
  buildUserContext,
  setUserContext,
} from '@shipfox/api-auth-context';
import {requireMembership} from '@shipfox/api-workspaces';
import type {AuthMethod} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {provisionedRunners} from '#db/schema/provisioned-runners.js';
import {runningJobs} from '#db/schema/running-jobs.js';
import {runnerRoutes} from './index.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(),
}));

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
    await db().execute(sql`TRUNCATE runners_provisioned_runners, runners_running_jobs CASCADE`);
    workspaceId = crypto.randomUUID();
    vi.mocked(requireMembership).mockResolvedValue({
      workspaceId,
      workspace: {
        id: workspaceId,
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
      role: 'admin',
    });
    app = await createApp({
      auth: [
        fakeUserAuth,
        passthroughAuth(AUTH_RUNNER_TOKEN),
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
    const runnerSessionId = crypto.randomUUID();
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
      .insert(runningJobs)
      .values({
        workspaceId,
        jobId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
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
    const runnerSessionId = crypto.randomUUID();
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
      .insert(runningJobs)
      .values([
        {
          workspaceId,
          jobId: firstJobId,
          runId: crypto.randomUUID(),
          projectId: crypto.randomUUID(),
          runnerSessionId,
          requiredLabels: ['linux'],
          runnerLabels: ['linux'],
        },
        {
          workspaceId,
          jobId: secondJobId,
          runId: crypto.randomUUID(),
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
    const runnerSessionId = crypto.randomUUID();
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
      .insert(runningJobs)
      .values({
        workspaceId,
        jobId,
        runId: crypto.randomUUID(),
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
    const runnerSessionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await db()
      .insert(runningJobs)
      .values({
        workspaceId,
        jobId,
        runId: crypto.randomUUID(),
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

  it('returns 403 when the user is not a workspace member', async () => {
    vi.mocked(requireMembership).mockRejectedValueOnce(
      new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/runners/active`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
  });
});

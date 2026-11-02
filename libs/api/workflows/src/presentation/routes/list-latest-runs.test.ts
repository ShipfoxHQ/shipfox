import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createTestDevRun, createTestRun} from '#test/helpers/workflow-runs.js';
import {listLatestRunsRoute} from './list-latest-runs.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

const projects = {
  getProjectById: vi.fn(({projectId}) =>
    Promise.resolve({
      project: {
        id: projectId,
        workspaceId: projectAccessState.workspaceId,
        sourceConnectionId: crypto.randomUUID(),
        sourceExternalRepositoryId: 'repo',
        name: 'Project',
      },
    }),
  ),
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/workflows/runs/latest', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let memberWorkspaceId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId: memberWorkspaceId, role: 'admin', workspaceStatus: 'active'}],
        }),
      );
      done();
    });
    app.get('/api/workflows/runs/latest', listLatestRunsRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    memberWorkspaceId = workspaceId;
    projectAccessState.workspaceId = workspaceId;
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns the latest synced run for each requested definition', async () => {
    const withRuns = crypto.randomUUID();
    const withoutRuns = crypto.randomUUID();
    const run = await createTestRun({workspaceId, projectId, definitionId: withRuns});
    await createTestDevRun({workspaceId, projectId, definitionId: withRuns});

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/latest?project_id=${projectId}&definition_ids=${withRuns},${withoutRuns}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runs: [
        {
          id: run.id,
          definition_id: withRuns,
          number: 1,
          status: 'pending',
          created_at: expect.any(String),
        },
      ],
    });
  });

  test('refuses a project outside the caller workspaces', async () => {
    memberWorkspaceId = crypto.randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/latest?project_id=${projectId}&definition_ids=${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(403);
  });

  test('rejects a missing or malformed definition list', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/latest?project_id=${projectId}`,
    });
    const malformed = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/latest?project_id=${projectId}&definition_ids=not-a-uuid`,
    });

    expect(missing.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
  });
});

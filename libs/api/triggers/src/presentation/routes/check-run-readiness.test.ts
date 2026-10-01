import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createCheckRunReadinessRoute} from './check-run-readiness.js';

const checkRunReadiness = vi.fn();
const getProjectById = vi.fn();
const workflows = {checkRunReadiness} as unknown as WorkflowsModuleClient;
const projects = {getProjectById} as never;

describe('GET /workflow-definitions/readiness', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let memberships: Array<{
    workspaceId: string;
    role: 'admin';
    workspaceStatus: 'active' | 'suspended' | 'deleted';
  }>;

  const query = (definitionIds: string[], project = projectId) =>
    `/workflow-definitions/readiness?project_id=${project}${definitionIds
      .map((id) => `&definition_id=${id}`)
      .join('')}`;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({userId: crypto.randomUUID(), email: 'user@example.com', memberships}),
      );
      done();
    });
    const route = createCheckRunReadinessRoute(workflows, projects);
    app.get('/workflow-definitions/readiness', route);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    checkRunReadiness.mockReset();
    getProjectById.mockReset();
    getProjectById.mockResolvedValue({project: {id: projectId, workspaceId}});
    checkRunReadiness.mockResolvedValue({definitions: []});
  });

  test('passes the project and definition ids to the readiness check and maps issues to snake_case', async () => {
    const definitionId = crypto.randomUUID();
    checkRunReadiness.mockResolvedValue({
      definitions: [
        {
          definitionId,
          issues: [
            {
              kind: 'variable-missing',
              key: 'E2E_SCHEDULE_ENABLED',
              locations: [
                {jobKey: 'e2e', field: 'job.if'},
                {
                  jobKey: 'e2e',
                  step: {key: 'deploy', name: 'Deploy', index: 2},
                  field: 'env',
                  envKey: 'TOKEN',
                },
              ],
              moreLocations: 3,
              effect: 'blocks-start',
            },
          ],
        },
      ],
    });

    const res = await app.inject({method: 'GET', url: query([definitionId])});

    expect(res.statusCode).toBe(200);
    expect(checkRunReadiness).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      definitionIds: [definitionId],
    });
    expect(res.json()).toEqual({
      definitions: [
        {
          definition_id: definitionId,
          issues: [
            {
              kind: 'variable-missing',
              key: 'E2E_SCHEDULE_ENABLED',
              locations: [
                {job_key: 'e2e', field: 'job.if'},
                {
                  job_key: 'e2e',
                  step: {key: 'deploy', name: 'Deploy', index: 2},
                  field: 'env',
                  env_key: 'TOKEN',
                },
              ],
              more_locations: 3,
              effect: 'blocks-start',
            },
          ],
        },
      ],
    });
  });

  test('maps an agent configuration issue, which has no key', async () => {
    const definitionId = crypto.randomUUID();
    checkRunReadiness.mockResolvedValue({
      definitions: [
        {
          definitionId,
          issues: [
            {
              kind: 'agent-config-invalid',
              reason: 'model-unknown',
              model: 'gpt-nine',
              provider: 'openai',
              locations: [
                {jobKey: 'review', step: {key: 'triage', index: 1}, field: 'agent.model'},
              ],
              effect: 'fails-job',
            },
          ],
        },
      ],
    });

    const res = await app.inject({method: 'GET', url: query([definitionId])});

    expect(res.statusCode).toBe(200);
    expect(res.json().definitions[0].issues).toEqual([
      {
        kind: 'agent-config-invalid',
        reason: 'model-unknown',
        model: 'gpt-nine',
        provider: 'openai',
        locations: [{job_key: 'review', step: {key: 'triage', index: 1}, field: 'agent.model'}],
        effect: 'fails-job',
      },
    ]);
  });

  test('omits more_locations when every location is listed', async () => {
    const definitionId = crypto.randomUUID();
    checkRunReadiness.mockResolvedValue({
      definitions: [
        {
          definitionId,
          issues: [
            {
              kind: 'variable-missing',
              key: 'K',
              locations: [{jobKey: 'build', field: 'run'}],
              effect: 'fails-job',
            },
          ],
        },
      ],
    });

    const res = await app.inject({method: 'GET', url: query([definitionId])});

    expect(res.statusCode).toBe(200);
    expect(res.json().definitions[0].issues[0]).not.toHaveProperty('more_locations');
  });

  test('returns an empty definition list when nothing matches', async () => {
    const res = await app.inject({method: 'GET', url: query([crypto.randomUUID()])});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({definitions: []});
  });

  test('returns an empty issue list for a ready definition', async () => {
    const definitionId = crypto.randomUUID();
    checkRunReadiness.mockResolvedValue({definitions: [{definitionId, issues: []}]});

    const res = await app.inject({method: 'GET', url: query([definitionId])});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({definitions: [{definition_id: definitionId, issues: []}]});
  });

  test('accepts up to 100 definition ids', async () => {
    const ids = Array.from({length: 100}, () => crypto.randomUUID());

    const res = await app.inject({method: 'GET', url: query(ids)});

    expect(res.statusCode).toBe(200);
    expect(checkRunReadiness).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      definitionIds: ids,
    });
  });

  test('rejects more than 100 definition ids', async () => {
    const ids = Array.from({length: 101}, () => crypto.randomUUID());

    const res = await app.inject({method: 'GET', url: query(ids)});

    expect(res.statusCode).toBe(400);
    expect(checkRunReadiness).not.toHaveBeenCalled();
  });

  test('rejects a request without definition ids', async () => {
    const res = await app.inject({method: 'GET', url: query([])});

    expect(res.statusCode).toBe(400);
    expect(checkRunReadiness).not.toHaveBeenCalled();
  });

  test('rejects a definition id that is not a UUID', async () => {
    const res = await app.inject({method: 'GET', url: query(['not-a-uuid'])});

    expect(res.statusCode).toBe(400);
    expect(checkRunReadiness).not.toHaveBeenCalled();
  });

  test('returns 404 when the project does not exist', async () => {
    getProjectById.mockResolvedValue({project: null});

    const res = await app.inject({method: 'GET', url: query([crypto.randomUUID()])});

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('project-not-found');
    expect(checkRunReadiness).not.toHaveBeenCalled();
  });

  test('refuses a caller who is not a member of the project workspace', async () => {
    memberships = [{workspaceId: crypto.randomUUID(), role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({method: 'GET', url: query([crypto.randomUUID()])});

    expect(res.statusCode).toBe(403);
    expect(checkRunReadiness).not.toHaveBeenCalled();
  });

  test('refuses a caller whose workspace is suspended', async () => {
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'suspended'}];

    const res = await app.inject({method: 'GET', url: query([crypto.randomUUID()])});

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
    expect(checkRunReadiness).not.toHaveBeenCalled();
  });
});

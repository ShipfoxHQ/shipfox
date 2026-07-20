import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {buildCreateDefinitionRoute} from './create-definition.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: '', sourceConnectionId: ''}));

const projects = {
  getProjectById: vi.fn(({projectId}) =>
    Promise.resolve({
      project: {
        id: projectId,
        workspaceId: projectAccessState.workspaceId,
        sourceConnectionId: projectAccessState.sourceConnectionId,
        sourceExternalRepositoryId: 'repo',
        name: 'Project',
      },
    }),
  ),
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('POST /api/definitions', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

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
          memberships: [{workspaceId, role: 'admin'}],
        }),
      );
      done();
    });
    app.post('/api/definitions', buildCreateDefinitionRoute({projects}));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
    projectAccessState.sourceConnectionId = crypto.randomUUID();
  });

  const validYaml = `
name: Test Workflow
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: echo hello
`;

  test('valid YAML returns 200 with definition response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: '.shipfox/workflows/test.yml', yaml: validYaml},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.project_id).toBe(projectId);
    expect(body.config_path).toBe('.shipfox/workflows/test.yml');
    expect(body.source).toBe('manual');
    expect(body.name).toBe('Test Workflow');
    expect(body.workflow_document.name).toBe('Test Workflow');
    expect(body.workflow_model.kind).toBe('workflow');
    expect(body.sha).toBeNull();
    expect(body.ref).toBeNull();
    expect(body.fetched_at).toBeDefined();
  });

  test('skips connection snapshot loading when YAML has no integrations', async () => {
    const loadWorkspaceConnectionSnapshot = vi.fn(() => Promise.resolve(new Map()));
    const appWithOptions = Fastify();
    appWithOptions.setValidatorCompiler(validatorCompiler);
    appWithOptions.setSerializerCompiler(serializerCompiler);
    appWithOptions.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin'}],
        }),
      );
      done();
    });
    appWithOptions.post(
      '/api/definitions',
      buildCreateDefinitionRoute({
        projects,
        agentToolSelectionCatalogs: new Map(),
        loadWorkspaceConnectionSnapshot,
      }),
    );
    await appWithOptions.ready();

    const res = await appWithOptions.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {
        project_id: projectId,
        config_path: '.shipfox/workflows/test.yml',
        yaml: validYaml,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(loadWorkspaceConnectionSnapshot).not.toHaveBeenCalled();
  });

  test('uses the project source connection as the default integration connection', async () => {
    const loadWorkspaceConnectionSnapshot = vi.fn(() =>
      Promise.resolve(
        new Map([
          [
            'github-main',
            {
              id: projectAccessState.sourceConnectionId,
              provider: 'github',
              capabilities: ['agent_tools'] as const,
            },
          ],
        ]),
      ),
    );
    const getIntegrationConnectionById = vi.fn(() =>
      Promise.resolve({
        id: projectAccessState.sourceConnectionId,
        workspaceId,
        provider: 'github',
        externalAccountId: 'installation-1',
        slug: 'github-main',
        displayName: 'GitHub',
        lifecycleStatus: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const appWithOptions = Fastify();
    appWithOptions.setValidatorCompiler(validatorCompiler);
    appWithOptions.setSerializerCompiler(serializerCompiler);
    appWithOptions.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin'}],
        }),
      );
      done();
    });
    appWithOptions.post(
      '/api/definitions',
      buildCreateDefinitionRoute({
        projects,
        agentToolSelectionCatalogs: new Map([
          [
            'github',
            {
              selectors: [
                {token: 'issue_read', kind: 'family', sensitivity: 'read', sensitive: false},
              ],
            },
          ],
        ]),
        loadWorkspaceConnectionSnapshot,
        getIntegrationConnectionById,
      }),
    );
    await appWithOptions.ready();

    const res = await appWithOptions.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {
        project_id: projectId,
        config_path: '.shipfox/workflows/test.yml',
        yaml: `
name: Agent Workflow
runner: ubuntu-latest
jobs:
  build:
    steps:
      - prompt: Fix the issue
        integrations:
          - include: [issue_read]
`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(getIntegrationConnectionById).toHaveBeenCalledWith(
      projectAccessState.sourceConnectionId,
    );
  });

  test('invalid YAML syntax returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {
        project_id: projectId,
        config_path: 'test.yml',
        yaml: 'name: Bad\n  invalid:\nindentation',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  test('valid YAML with invalid definition returns 400 with error code', async () => {
    const yamlMissingName = `
jobs:
  build:
    steps:
      - run: echo hello
`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'test.yml', yaml: yamlMissingName},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-workflow-definition');
  });

  test('cyclic DAG returns 400 with dag error code', async () => {
    const cyclicYaml = `
name: Cyclic
runner: ubuntu-latest
jobs:
  a:
    needs: b
    steps:
      - run: echo a
  b:
    needs: a
    steps:
      - run: echo b
`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'test.yml', yaml: cyclicYaml},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-workflow-definition');
  });

  test('upsert same config_path updates the definition', async () => {
    const payload1 = {project_id: projectId, config_path: 'deploy.yml', yaml: validYaml};

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: payload1,
    });

    const updatedYaml = `
name: Updated Workflow
runner: ubuntu-latest
jobs:
  deploy:
    steps:
      - run: ./deploy.sh
`;
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'deploy.yml', yaml: updatedYaml},
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().id).toBe(res1.json().id);
    expect(res2.json().name).toBe('Updated Workflow');
  });

  test('runner-less YAML returns validation details with the runner path', async () => {
    const yaml = `
name: Missing Runner
jobs:
  build:
    steps:
      - run: echo hello
`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'test.yml', yaml},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'invalid-workflow-definition',
      details: [expect.objectContaining({path: 'jobs.build.runner'})],
    });
  });

  test('missing body fields returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  test('invalid projectId UUID returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: 'not-a-uuid', config_path: 'test.yml', yaml: validYaml},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBeDefined();
  });

  test('creates a manual definition without a config path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, yaml: validYaml},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().config_path).toBeNull();
    expect(res.json().source).toBe('manual');
  });

  test('rejects a VCS definition without a config path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, source: 'vcs', yaml: validYaml},
    });

    expect(res.statusCode).toBe(400);
  });
});

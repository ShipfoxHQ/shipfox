import {AUTH_USER, setUserContext} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {LocalWorkflowsError, type LocalWorkflowsService} from '#core/local-workflows.js';
import {createLocalWorkflowsRoutes} from './index.js';

vi.mock('@shipfox/api-projects', () => ({
  requireProjectAccess: vi.fn(({projectId}) =>
    Promise.resolve({
      project: {id: projectId, workspaceId: 'workspace-1'},
      workspaceId: 'workspace-1',
    }),
  ),
}));

const projectId = '11111111-1111-4111-8111-111111111111';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(request, {
      userId: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      memberships: [],
      canAccess: () => true,
      hasRole: () => true,
    });
    return Promise.resolve();
  },
};

function createFakeService(overrides: Partial<LocalWorkflowsService> = {}): LocalWorkflowsService {
  return {
    baseUrl: 'http://127.0.0.1:8765',
    getStatus: vi.fn(() =>
      Promise.resolve({
        base_url: 'http://127.0.0.1:8765',
        reachable: true,
        latest_fake_alert: null,
        setup_hint: null,
      }),
    ),
    listWorkflows: vi.fn(() => Promise.resolve({workflows: []})),
    getWorkflow: vi.fn((workflowId: string) =>
      Promise.resolve({
        preparation_id: 'prep-1',
        workflow: {workflow_id: workflowId, name: 'restore_checkout'},
        triggers: [],
        required_services: [],
        action_requirements: [],
        source: {source_name: 'restore_checkout_exec.fox', source_text: 'source'},
        iface_text: 'iface',
      }),
    ),
    listRuns: vi.fn(() =>
      Promise.resolve({
        runs: [
          {
            run_id: 'run-001',
            workflow_name: 'restore_checkout',
            provider_event_id: 'alert-001',
            status: 'completed',
          },
        ],
      }),
    ),
    getRun: vi.fn((runId: string) =>
      Promise.resolve({
        run: {
          run: {run_id: runId, workflow_name: 'restore_checkout', status: 'completed'},
          actions: [],
          events: [],
        },
        status: 'completed' as const,
      }),
    ),
    triggerFakeAlert: vi.fn(() =>
      Promise.resolve({
        run_id: 'run-001',
        result: {
          run: {
            run: {run_id: 'run-001', workflow_name: 'restore_checkout', status: 'completed'},
            actions: [],
            events: [],
          },
          status: 'completed' as const,
        },
      }),
    ),
    ...overrides,
  };
}

describe('local workflow routes', () => {
  let app: FastifyInstance;
  let service: LocalWorkflowsService;

  beforeEach(async () => {
    await closeApp();
    service = createFakeService();
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createLocalWorkflowsRoutes(service),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('lists runs for a project', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/local-workflows/projects/${projectId}/runs`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runs[0].run_id).toBe('run-001');
    expect(service.listRuns).toHaveBeenCalled();
  });

  test('forwards fake alerts through the platform route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/local-workflows/projects/${projectId}/fake-alerts`,
      headers: {authorization: 'Bearer user'},
      payload: {
        id: 'alert-001',
        severity: 'critical',
        message: 'checkout conversion degraded',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().run_id).toBe('run-001');
    expect(service.triggerFakeAlert).toHaveBeenCalledWith({
      id: 'alert-001',
      severity: 'critical',
      message: 'checkout conversion degraded',
    });
  });

  test('maps local-service adapter errors to client errors', async () => {
    await closeApp();
    service = createFakeService({
      listRuns: vi.fn(() =>
        Promise.reject(
          new LocalWorkflowsError({
            message: 'Local workflows service is unavailable',
            code: 'local-service-unavailable',
            status: 503,
          }),
        ),
      ),
    });
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createLocalWorkflowsRoutes(service),
      swagger: false,
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/local-workflows/projects/${projectId}/runs`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('local-service-unavailable');
  });
});

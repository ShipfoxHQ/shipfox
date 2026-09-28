import {listWorkspaceWorkflowTemplatesResponseSchema} from '@shipfox/api-agent-access-dto';
import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  type FastifyRequest,
} from '@shipfox/node-fastify';
import {shippedTemplateLoader} from '@shipfox/workflow-templates';
import {createWorkflowTemplateRoutes} from './workflow-template-routes.js';

let memberships: UserContextMembership[] = [];

const userAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }
    setUserContext(
      request,
      buildUserContext({userId: crypto.randomUUID(), email: 'user@example.com', memberships}),
    );
    return Promise.resolve();
  },
};

describe('GET /workspaces/:workspaceId/workflow-templates', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let workspaceId: string;
  let listConnectionsByWorkspace: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    listConnectionsByWorkspace = vi.fn().mockResolvedValue({
      connections: [
        connection('github-main', 'github'),
        {...connection('slack-old', 'slack'), lifecycleStatus: 'disabled'},
      ],
      nextCursor: null,
    });
    app = await createApp({
      auth: [userAuth],
      routes: [
        createWorkflowTemplateRoutes({
          templates: shippedTemplateLoader,
          integrations: {listConnectionsByWorkspace} as unknown as IntegrationsModuleClient,
        }),
      ],
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('ranks templates by group for a GitHub-only workspace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/workflow-templates`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode, res.body).toBe(200);
    const body = listWorkspaceWorkflowTemplatesResponseSchema.parse(res.json());
    expect(body.templates.map(({id, group}) => [id, group])).toEqual([
      ['ticket-to-pr', 'try_now'],
      ['fix-default-branch-ci', 'starts_on_event'],
      ['fix-dependency-ci', 'starts_on_event'],
      ['ask-codebase', 'needs_connection'],
      ['slack-to-ticket', 'needs_connection'],
      ['report-failed-runs', 'needs_connection'],
    ]);
    expect(body.templates[0]).toEqual({
      id: 'ticket-to-pr',
      title: 'Task to pull request',
      summary: 'Turn a ticket or a request into a tested GitHub pull request.',
      group: 'try_now',
      start_label: null,
      providers: ['github', 'linear', 'jira'],
      missing_providers: [],
      prompt: 'Use Shipfox to create a workflow from the ticket-to-pr template.',
    });
    expect(body.templates[1]).toMatchObject({
      start_label: 'Starts when CI fails on the default branch',
    });
    expect(body.templates.find(({id}) => id === 'slack-to-ticket')).toMatchObject({
      missing_providers: ['slack', 'linear'],
    });
    expect(listConnectionsByWorkspace).toHaveBeenCalledWith({workspaceId, limit: 100});
  });

  test('returns 401 without user auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/workflow-templates`,
    });

    expect(res.statusCode).toBe(401);
  });

  test('returns 403 when the user is not a workspace member', async () => {
    memberships = [];

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/workflow-templates`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    expect(listConnectionsByWorkspace).not.toHaveBeenCalled();
  });
});

function connection(slug: string, provider: string) {
  return {
    id: crypto.randomUUID(),
    slug,
    provider,
    displayName: provider,
    lifecycleStatus: 'active',
    capabilities: ['source_control'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

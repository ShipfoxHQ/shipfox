import type {GithubApiClient} from '#api/client.js';
import {GithubAgentToolsProvider, githubAgentToolCatalog} from '#core/agent-tools.js';
import {createGithubIntegrationProvider} from '#index.js';

const expectedCatalogRows = [
  {
    id: 'issue_read',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
    methods: ['get', 'get_comments', 'get_sub_issues', 'get_parent', 'get_labels'],
  },
  {
    id: 'list_issue_types',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
  },
  {
    id: 'list_issues',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
  },
  {
    id: 'search_issues',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
  },
  {
    id: 'add_issue_comment',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
  },
  {
    id: 'issue_write',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
    methods: ['create', 'update'],
  },
  {
    id: 'sub_issue_write',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
    methods: ['add', 'remove', 'reprioritize'],
  },
  {
    id: 'pull_request_read',
    category: 'pull_requests',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [
      {permission: 'pull_requests', access: 'read'},
      {permission: 'issues', access: 'read'},
    ],
    methods: [
      'get',
      'get_diff',
      'get_status',
      'get_files',
      'get_commits',
      'get_review_comments',
      'get_reviews',
      'get_comments',
      'get_check_runs',
    ],
  },
  {
    id: 'list_pull_requests',
    category: 'pull_requests',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'read'}],
  },
  {
    id: 'search_pull_requests',
    category: 'pull_requests',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'read'}],
  },
  {
    id: 'create_pull_request',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'update_pull_request',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'add_reply_to_pull_request_comment',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'merge_pull_request',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: [
      {permission: 'pull_requests', access: 'write'},
      {permission: 'contents', access: 'write'},
    ],
  },
  {
    id: 'update_pull_request_branch',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'pull_request_review_write',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
    methods: ['create', 'submit_pending', 'delete_pending', 'resolve_thread', 'unresolve_thread'],
  },
  {
    id: 'add_comment_to_pending_review',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'actions_list',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
    methods: [
      'list_workflows',
      'list_workflow_runs',
      'list_workflow_jobs',
      'list_workflow_run_artifacts',
    ],
  },
  {
    id: 'actions_get',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
    methods: [
      'get_workflow',
      'get_workflow_run',
      'get_workflow_job',
      'download_workflow_run_artifact',
      'get_workflow_run_usage',
      'get_workflow_run_logs_url',
    ],
  },
  {
    id: 'actions_run_trigger',
    category: 'actions',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: [{permission: 'actions', access: 'write'}],
    methods: [
      'run_workflow',
      'rerun_workflow_run',
      'rerun_failed_jobs',
      'cancel_workflow_run',
      'delete_workflow_run_logs',
    ],
  },
  {
    id: 'get_job_logs',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
];

describe('github agent tool catalog', () => {
  it('matches the GitHub MCP-style tool rows', () => {
    const rows = githubAgentToolCatalog.map(
      ({id, category, sensitivity, sensitive, requiredScope, methods}) => ({
        id,
        category,
        sensitivity,
        sensitive,
        requiredScope,
        ...(methods ? {methods: methods.map((method) => method.id)} : {}),
      }),
    );

    expect(rows).toEqual(expectedCatalogRows);
  });

  it('defines descriptions and schemas for every tool and method', () => {
    const entriesMissingCatalogData = githubAgentToolCatalog.filter(
      (entry) =>
        entry.description.trim().length === 0 ||
        entry.inputSchema.type !== 'object' ||
        entry.outputSchema?.type !== 'object' ||
        entry.methods?.some((method) => method.description.trim().length === 0),
    );

    expect(entriesMissingCatalogData).toEqual([]);
  });

  it('defines method enums for method-based tools', () => {
    const entriesWithWrongMethodEnums = githubAgentToolCatalog.filter((entry) => {
      if (!entry.methods) return false;

      const inputSchema = entry.inputSchema as {
        properties?: Record<string, {enum?: unknown[] | undefined}> | undefined;
      };
      const methodProperty = inputSchema.properties?.method;
      return (
        !methodProperty ||
        !Array.isArray(methodProperty.enum) ||
        methodProperty.enum.join(',') !== entry.methods.map((method) => method.id).join(',')
      );
    });

    expect(entriesWithWrongMethodEnums).toEqual([]);
  });

  it('uses unique bare native ids', () => {
    const ids = githubAgentToolCatalog.map((entry) => entry.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
    expect(ids.every((id) => !id.includes('.') && !id.includes('__'))).toBe(true);
  });

  it('exposes the catalog through the provider adapter', () => {
    const provider = createProvider();
    const catalog = provider.adapters.agent_tools?.catalog();

    expect(provider.adapters.agent_tools).toBeDefined();
    expect(catalog).toBe(githubAgentToolCatalog);
  });

  it('fails closed for execution until dispatch is implemented', async () => {
    const provider = new GithubAgentToolsProvider();

    const result = provider.openSession();

    await expect(result).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
  });
});

function createProvider() {
  return createGithubIntegrationProvider({
    github: githubClient(),
    getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
    connectGithubInstallation: vi.fn() as never,
    coreDb: vi.fn() as never,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
    publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
  });
}

function githubClient(): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.reject(new Error('not used'))),
    listUserInstallations: vi.fn(() => Promise.reject(new Error('not used'))),
    getInstallation: vi.fn(() => Promise.reject(new Error('not used'))),
    listInstallationRepositories: vi.fn(() => Promise.reject(new Error('not used'))),
    getRepository: vi.fn(() => Promise.reject(new Error('not used'))),
    listRepositoryFiles: vi.fn(() => Promise.reject(new Error('not used'))),
    fetchRepositoryFile: vi.fn(() => Promise.reject(new Error('not used'))),
    createInstallationAccessToken: vi.fn(() => Promise.reject(new Error('not used'))),
  };
}

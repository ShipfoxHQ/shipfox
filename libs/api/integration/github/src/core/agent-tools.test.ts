import type {GithubApiClient} from '#api/client.js';
import {GithubAgentToolsProvider, githubAgentToolCatalog} from '#core/agent-tools.js';
import {createGithubIntegrationProvider} from '#index.js';

const expectedCatalogRows = [
  {
    id: 'get_issue',
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
    id: 'create_issue',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
  },
  {
    id: 'update_issue',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
  },
  {
    id: 'get_pull_request',
    category: 'pull_requests',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'read'}],
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
    id: 'add_pull_request_review_comment',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'create_pull_request_review',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'request_reviewers',
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
    id: 'list_workflows',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
  {
    id: 'list_workflow_runs',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
  {
    id: 'get_workflow_run',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
  {
    id: 'get_workflow_run_logs',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
  {
    id: 'list_workflow_jobs',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
  {
    id: 'get_job_logs',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
  {
    id: 'run_workflow',
    category: 'actions',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: [{permission: 'actions', access: 'write'}],
  },
  {
    id: 'rerun_workflow_run',
    category: 'actions',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'write'}],
  },
  {
    id: 'cancel_workflow_run',
    category: 'actions',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'write'}],
  },
];

describe('github agent tool catalog', () => {
  it('matches the Appendix A tool rows', () => {
    const rows = githubAgentToolCatalog.map(
      ({id, category, sensitivity, sensitive, requiredScope}) => ({
        id,
        category,
        sensitivity,
        sensitive,
        requiredScope,
      }),
    );

    expect(rows).toEqual(expectedCatalogRows);
  });

  it('defines descriptions and schemas for every tool', () => {
    const entriesMissingCatalogData = githubAgentToolCatalog.filter(
      (entry) =>
        entry.description.trim().length === 0 ||
        entry.inputSchema.type !== 'object' ||
        entry.outputSchema?.type !== 'object',
    );

    expect(entriesMissingCatalogData).toEqual([]);
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

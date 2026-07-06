import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolsProvider,
  IntegrationConnection,
} from '@shipfox/api-integration-core-dto';
import {GithubIntegrationProviderError} from './errors.js';

type GithubIntegrationConnection = IntegrationConnection<'github'>;

export type GithubAgentToolCategory = 'issues' | 'pull_requests' | 'actions';
export type GithubAgentToolPermission = 'actions' | 'contents' | 'issues' | 'pull_requests';
export type GithubAgentToolPermissionAccess = 'read' | 'write';

export interface GithubAgentToolRequiredPermission {
  permission: GithubAgentToolPermission;
  access: GithubAgentToolPermissionAccess;
}

export type GithubAgentToolRequiredScope = readonly GithubAgentToolRequiredPermission[];

export interface GithubAgentToolCatalogEntry
  extends AgentToolCatalogEntry<GithubAgentToolRequiredScope> {
  category: GithubAgentToolCategory;
}

const scopes = {
  issuesRead: [{permission: 'issues', access: 'read'}],
  issuesWrite: [{permission: 'issues', access: 'write'}],
  pullRequestsRead: [{permission: 'pull_requests', access: 'read'}],
  pullRequestsWrite: [{permission: 'pull_requests', access: 'write'}],
  actionsRead: [{permission: 'actions', access: 'read'}],
  actionsWrite: [{permission: 'actions', access: 'write'}],
  mergePullRequest: [
    {permission: 'pull_requests', access: 'write'},
    {permission: 'contents', access: 'write'},
  ],
} as const satisfies Record<string, GithubAgentToolRequiredScope>;

const repositoryProperties = {
  owner: stringSchema('Repository owner login'),
  repo: stringSchema('Repository name'),
};

const issueNumber = integerSchema('GitHub issue number');
const pullNumber = integerSchema('GitHub pull request number');
const runId = integerSchema('GitHub Actions workflow run id');
const jobId = integerSchema('GitHub Actions job id');
const workflowId = {
  description: 'GitHub Actions workflow id, node id, or workflow file name',
  anyOf: [integerSchema(), stringSchema()],
};
const pageProperties = {
  per_page: integerSchema('Results per page', {minimum: 1, maximum: 100}),
  page: integerSchema('Page number', {minimum: 1}),
};

export const githubAgentToolCatalog = [
  {
    id: 'get_issue',
    category: 'issues',
    description: 'Get a GitHub issue by number.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    inputSchema: repositoryInputSchema({issue_number: issueNumber}, ['issue_number']),
    outputSchema: objectSchema({issue: openObjectSchema('GitHub issue')}, ['issue']),
  },
  {
    id: 'list_issues',
    category: 'issues',
    description: 'List GitHub issues in a repository.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    inputSchema: repositoryInputSchema({
      state: enumSchema(['open', 'closed', 'all'], 'Issue state filter'),
      labels: arraySchema(stringSchema('Label name')),
      ...pageProperties,
    }),
    outputSchema: objectSchema({issues: arraySchema(openObjectSchema('GitHub issue'))}, ['issues']),
  },
  {
    id: 'search_issues',
    category: 'issues',
    description: 'Search GitHub issues in a repository.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    inputSchema: repositoryInputSchema({query: stringSchema('Search query'), ...pageProperties}, [
      'query',
    ]),
    outputSchema: objectSchema({issues: arraySchema(openObjectSchema('GitHub issue'))}, ['issues']),
  },
  {
    id: 'add_issue_comment',
    category: 'issues',
    description: 'Add a comment to a GitHub issue or pull request conversation.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.issuesWrite,
    inputSchema: repositoryInputSchema(
      {
        issue_number: issueNumber,
        body: stringSchema('Markdown comment body'),
      },
      ['issue_number', 'body'],
    ),
    outputSchema: objectSchema({comment: openObjectSchema('Created issue comment')}, ['comment']),
  },
  {
    id: 'create_issue',
    category: 'issues',
    description: 'Create a GitHub issue.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.issuesWrite,
    inputSchema: repositoryInputSchema(
      {
        title: stringSchema('Issue title'),
        body: stringSchema('Issue body'),
        labels: arraySchema(stringSchema('Label name')),
        assignees: arraySchema(stringSchema('GitHub username')),
      },
      ['title'],
    ),
    outputSchema: objectSchema({issue: openObjectSchema('Created GitHub issue')}, ['issue']),
  },
  {
    id: 'update_issue',
    category: 'issues',
    description: 'Update a GitHub issue title, body, state, labels, or assignees.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.issuesWrite,
    inputSchema: repositoryInputSchema(
      {
        issue_number: issueNumber,
        title: stringSchema('Issue title'),
        body: stringSchema('Issue body'),
        state: enumSchema(['open', 'closed'], 'Issue state'),
        labels: arraySchema(stringSchema('Label name')),
        assignees: arraySchema(stringSchema('GitHub username')),
      },
      ['issue_number'],
    ),
    outputSchema: objectSchema({issue: openObjectSchema('Updated GitHub issue')}, ['issue']),
  },
  {
    id: 'get_pull_request',
    category: 'pull_requests',
    description: 'Get a GitHub pull request by number, including optional details.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.pullRequestsRead,
    inputSchema: repositoryInputSchema(
      {
        pull_number: pullNumber,
        include_diff: booleanSchema('Include the pull request diff'),
        include_files: booleanSchema('Include changed files'),
        include_commits: booleanSchema('Include commits'),
        include_reviews: booleanSchema('Include reviews'),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema({pull_request: openObjectSchema('GitHub pull request')}, [
      'pull_request',
    ]),
  },
  {
    id: 'list_pull_requests',
    category: 'pull_requests',
    description: 'List GitHub pull requests in a repository.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.pullRequestsRead,
    inputSchema: repositoryInputSchema({
      state: enumSchema(['open', 'closed', 'all'], 'Pull request state filter'),
      base: stringSchema('Base branch'),
      head: stringSchema('Head branch or owner:branch'),
      ...pageProperties,
    }),
    outputSchema: objectSchema(
      {pull_requests: arraySchema(openObjectSchema('GitHub pull request'))},
      ['pull_requests'],
    ),
  },
  {
    id: 'search_pull_requests',
    category: 'pull_requests',
    description: 'Search GitHub pull requests in a repository.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.pullRequestsRead,
    inputSchema: repositoryInputSchema({query: stringSchema('Search query'), ...pageProperties}, [
      'query',
    ]),
    outputSchema: objectSchema(
      {pull_requests: arraySchema(openObjectSchema('GitHub pull request'))},
      ['pull_requests'],
    ),
  },
  {
    id: 'create_pull_request',
    category: 'pull_requests',
    description: 'Create a GitHub pull request.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        title: stringSchema('Pull request title'),
        head: stringSchema('Head branch or owner:branch'),
        base: stringSchema('Base branch'),
        body: stringSchema('Pull request body'),
        draft: booleanSchema('Create the pull request as a draft'),
      },
      ['title', 'head', 'base'],
    ),
    outputSchema: objectSchema({pull_request: openObjectSchema('Created GitHub pull request')}, [
      'pull_request',
    ]),
  },
  {
    id: 'update_pull_request',
    category: 'pull_requests',
    description: 'Update a GitHub pull request title, body, state, base branch, or draft state.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: pullNumber,
        title: stringSchema('Pull request title'),
        body: stringSchema('Pull request body'),
        state: enumSchema(['open', 'closed'], 'Pull request state'),
        base: stringSchema('Base branch'),
        draft: booleanSchema('Draft state'),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema({pull_request: openObjectSchema('Updated GitHub pull request')}, [
      'pull_request',
    ]),
  },
  {
    id: 'add_pull_request_review_comment',
    category: 'pull_requests',
    description: 'Add an inline review comment to a GitHub pull request diff.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: pullNumber,
        body: stringSchema('Markdown review comment body'),
        path: stringSchema('File path in the pull request diff'),
        line: integerSchema('Line number in the diff'),
        side: enumSchema(['LEFT', 'RIGHT'], 'Diff side'),
        commit_id: stringSchema('Commit SHA for the review comment'),
      },
      ['pull_number', 'body', 'path', 'line'],
    ),
    outputSchema: objectSchema({comment: openObjectSchema('Created pull request review comment')}, [
      'comment',
    ]),
  },
  {
    id: 'create_pull_request_review',
    category: 'pull_requests',
    description: 'Create a GitHub pull request review.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: pullNumber,
        event: enumSchema(['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], 'Review event'),
        body: stringSchema('Markdown review body'),
        comments: arraySchema(
          objectSchema(
            {
              path: stringSchema('File path in the pull request diff'),
              line: integerSchema('Line number in the diff'),
              body: stringSchema('Markdown review comment body'),
              side: enumSchema(['LEFT', 'RIGHT'], 'Diff side'),
            },
            ['path', 'line', 'body'],
          ),
        ),
      },
      ['pull_number', 'event'],
    ),
    outputSchema: objectSchema({review: openObjectSchema('Created pull request review')}, [
      'review',
    ]),
  },
  {
    id: 'request_reviewers',
    category: 'pull_requests',
    description: 'Request users or teams to review a GitHub pull request.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: pullNumber,
        reviewers: arraySchema(stringSchema('GitHub username')),
        team_reviewers: arraySchema(stringSchema('GitHub team slug')),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema(
      {pull_request: openObjectSchema('GitHub pull request with requested reviewers')},
      ['pull_request'],
    ),
  },
  {
    id: 'merge_pull_request',
    category: 'pull_requests',
    description: 'Merge a GitHub pull request into its base branch.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: scopes.mergePullRequest,
    inputSchema: repositoryInputSchema(
      {
        pull_number: pullNumber,
        commit_title: stringSchema('Merge commit title'),
        commit_message: stringSchema('Merge commit message'),
        merge_method: enumSchema(['merge', 'squash', 'rebase'], 'Merge method'),
        sha: stringSchema('Expected head SHA'),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema({merge: openObjectSchema('Merge result')}, ['merge']),
  },
  {
    id: 'list_workflows',
    category: 'actions',
    description: 'List GitHub Actions workflows in a repository.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema(pageProperties),
    outputSchema: objectSchema(
      {workflows: arraySchema(openObjectSchema('GitHub Actions workflow'))},
      ['workflows'],
    ),
  },
  {
    id: 'list_workflow_runs',
    category: 'actions',
    description: 'List GitHub Actions workflow runs in a repository.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema({
      workflow_id: workflowId,
      branch: stringSchema('Branch name'),
      status: enumSchema(
        [
          'completed',
          'action_required',
          'cancelled',
          'failure',
          'neutral',
          'skipped',
          'stale',
          'success',
          'timed_out',
          'in_progress',
          'queued',
          'requested',
          'waiting',
          'pending',
        ],
        'Workflow run status',
      ),
      event: stringSchema('Triggering event name'),
      ...pageProperties,
    }),
    outputSchema: objectSchema(
      {workflow_runs: arraySchema(openObjectSchema('GitHub Actions workflow run'))},
      ['workflow_runs'],
    ),
  },
  {
    id: 'get_workflow_run',
    category: 'actions',
    description: 'Get a GitHub Actions workflow run by id.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema({run_id: runId}, ['run_id']),
    outputSchema: objectSchema({workflow_run: openObjectSchema('GitHub Actions workflow run')}, [
      'workflow_run',
    ]),
  },
  {
    id: 'get_workflow_run_logs',
    category: 'actions',
    description: 'Get download metadata for GitHub Actions workflow run logs.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema({run_id: runId}, ['run_id']),
    outputSchema: objectSchema(
      {logs: openObjectSchema('GitHub Actions workflow run log metadata')},
      ['logs'],
    ),
  },
  {
    id: 'list_workflow_jobs',
    category: 'actions',
    description: 'List jobs for a GitHub Actions workflow run.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema(
      {
        run_id: runId,
        filter: enumSchema(['latest', 'all'], 'Workflow jobs filter'),
        ...pageProperties,
      },
      ['run_id'],
    ),
    outputSchema: objectSchema(
      {jobs: arraySchema(openObjectSchema('GitHub Actions workflow job'))},
      ['jobs'],
    ),
  },
  {
    id: 'get_job_logs',
    category: 'actions',
    description: 'Get download metadata for GitHub Actions job logs.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema({job_id: jobId}, ['job_id']),
    outputSchema: objectSchema({logs: openObjectSchema('GitHub Actions job log metadata')}, [
      'logs',
    ]),
  },
  {
    id: 'run_workflow',
    category: 'actions',
    description: 'Dispatch a GitHub Actions workflow run.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: scopes.actionsWrite,
    inputSchema: repositoryInputSchema(
      {
        workflow_id: workflowId,
        ref: stringSchema('Git ref to run the workflow on'),
        inputs: {
          type: 'object',
          description: 'Workflow dispatch inputs',
          additionalProperties: {type: ['string', 'number', 'boolean']},
        },
      },
      ['workflow_id', 'ref'],
    ),
    outputSchema: objectSchema({dispatch: openObjectSchema('Workflow dispatch result')}, [
      'dispatch',
    ]),
  },
  {
    id: 'rerun_workflow_run',
    category: 'actions',
    description: 'Rerun a GitHub Actions workflow run.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.actionsWrite,
    inputSchema: repositoryInputSchema(
      {
        run_id: runId,
        enable_debug_logging: booleanSchema('Enable debug logging for the rerun'),
      },
      ['run_id'],
    ),
    outputSchema: objectSchema({rerun: openObjectSchema('Workflow rerun result')}, ['rerun']),
  },
  {
    id: 'cancel_workflow_run',
    category: 'actions',
    description: 'Cancel a GitHub Actions workflow run.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.actionsWrite,
    inputSchema: repositoryInputSchema({run_id: runId}, ['run_id']),
    outputSchema: objectSchema({cancellation: openObjectSchema('Workflow cancellation result')}, [
      'cancellation',
    ]),
  },
] as const satisfies readonly GithubAgentToolCatalogEntry[];

export type GithubAgentToolId = (typeof githubAgentToolCatalog)[number]['id'];

export class GithubAgentToolsProvider
  implements AgentToolsProvider<GithubIntegrationConnection, GithubAgentToolRequiredScope>
{
  catalog(): readonly GithubAgentToolCatalogEntry[] {
    return githubAgentToolCatalog;
  }

  async openSession(): Promise<never> {
    await Promise.resolve();
    throw new GithubIntegrationProviderError(
      'provider-unavailable',
      'GitHub agent tool execution is not implemented yet',
    );
  }
}

function repositoryInputSchema(
  properties: Record<string, AgentToolJsonSchema> = {},
  required: string[] = [],
): AgentToolJsonSchema {
  return objectSchema({...repositoryProperties, ...properties}, ['owner', 'repo', ...required]);
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
  };
}

function openObjectSchema(description: string): AgentToolJsonSchema {
  return {type: 'object', description, additionalProperties: true};
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description ? {description} : {})};
}

function integerSchema(
  description?: string,
  options: {minimum?: number | undefined; maximum?: number | undefined} = {},
): AgentToolJsonSchema {
  return {type: 'integer', ...(description ? {description} : {}), ...options};
}

function booleanSchema(description: string): AgentToolJsonSchema {
  return {type: 'boolean', description};
}

function enumSchema(values: string[], description: string): AgentToolJsonSchema {
  return {type: 'string', description, enum: values};
}

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}

import type {
  AgentToolCatalogEntry,
  AgentToolCatalogMethod,
  AgentToolJsonSchema,
  AgentToolRepositoryScopeClassifier,
  AgentToolRepositoryTarget,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

type GithubRepositoryScopeClassifier = AgentToolRepositoryScopeClassifier;

interface GithubCatalogMethod<RequiredScope = unknown>
  extends AgentToolCatalogMethod<RequiredScope> {
  repositoryScope: GithubRepositoryScopeClassifier;
  indirectTargetNote?: string | undefined;
  /**
   * Permission sets GitHub documents as sufficient instead of `requiredScope`. Both fields are
   * advisory provider requirements for catalog documentation and diagnostics.
   */
  alternativeScopes?: readonly RequiredScope[] | undefined;
}

interface GithubCatalogEntry<RequiredScope = unknown> extends AgentToolCatalogEntry<RequiredScope> {
  repositoryScope: GithubRepositoryScopeClassifier;
  indirectTargetNote?: string | undefined;
  methods?: readonly GithubCatalogMethod<RequiredScope>[] | undefined;
}

export const DEFAULT_JOB_LOG_TAIL_LINES = 500;

export type GithubAgentToolCategory =
  | 'issues'
  | 'pull_requests'
  | 'checks'
  | 'actions'
  | 'repository';
export type GithubAgentToolPermission =
  | 'actions'
  | 'checks'
  | 'contents'
  | 'issues'
  | 'pull_requests'
  | 'statuses';
export type GithubAgentToolPermissionAccess = 'read' | 'write';
export type GithubAgentToolSensitivity = 'read' | 'write';

export interface GithubAgentToolRequiredPermission {
  permission: GithubAgentToolPermission;
  access: GithubAgentToolPermissionAccess;
}

export type GithubAgentToolRequiredScope = readonly GithubAgentToolRequiredPermission[];

export type GithubAgentToolCatalogMethod = GithubCatalogMethod<GithubAgentToolRequiredScope>;

export interface GithubAgentToolCatalogEntry
  extends GithubCatalogEntry<GithubAgentToolRequiredScope> {
  category: GithubAgentToolCategory;
  methods?: readonly GithubAgentToolCatalogMethod[] | undefined;
}

interface GithubAgentToolCatalogInput {
  id: string;
  category: GithubAgentToolCategory;
  description: string;
  inputSchema: AgentToolJsonSchema;
  outputSchema: AgentToolJsonSchema;
  sensitivity?: GithubAgentToolSensitivity | undefined;
  sensitive?: boolean | undefined;
  requiredScope?: GithubAgentToolRequiredScope | undefined;
  repositoryScope?: GithubRepositoryScopeClassifier | undefined;
  indirectTargetNote?: string | undefined;
  methods?: readonly GithubAgentToolCatalogMethod[] | undefined;
}

export const GIT_TREE_ENTRY_MODES = ['100644', '100755', '120000', '160000'] as const;

const scopes = {
  issuesRead: [{permission: 'issues', access: 'read'}],
  issuesWrite: [{permission: 'issues', access: 'write'}],
  issueAndPullRequestCommentsWrite: [
    {permission: 'issues', access: 'write'},
    {permission: 'pull_requests', access: 'write'},
  ],
  pullRequestsRead: [{permission: 'pull_requests', access: 'read'}],
  contentsRead: [{permission: 'contents', access: 'read'}],
  pullRequestsWrite: [{permission: 'pull_requests', access: 'write'}],
  actionsRead: [{permission: 'actions', access: 'read'}],
  actionsWrite: [{permission: 'actions', access: 'write'}],
  checksRead: [{permission: 'checks', access: 'read'}],
  checksWrite: [{permission: 'checks', access: 'write'}],
  statusesRead: [{permission: 'statuses', access: 'read'}],
  contentsWrite: [{permission: 'contents', access: 'write'}],
  mergePullRequest: [
    {permission: 'pull_requests', access: 'write'},
    {permission: 'contents', access: 'write'},
  ],
} as const satisfies Record<string, GithubAgentToolRequiredScope>;

const repositoryProperties = {
  owner: stringSchema('Repository owner'),
  repo: stringSchema('Repository name'),
};

const indirectSearchTargetNote =
  'The free-form query may match results in repositories other than the declared target.';

const connectionRepositoryScope: GithubRepositoryScopeClassifier = () => ({kind: 'connection'});

const searchRepositoryScope: GithubRepositoryScopeClassifier = (arguments_) => {
  const owner = arguments_.owner;
  const repo = arguments_.repo;
  if (
    typeof owner === 'string' &&
    owner.length > 0 &&
    typeof repo === 'string' &&
    repo.length > 0
  ) {
    return {kind: 'declared-targets', repositories: [{owner, name: repo}]};
  }
  return {
    kind: 'connection',
    requiresExplicitRepository: true,
    indirectTargetNote: indirectSearchTargetNote,
  };
};

/** Classifies explicit repository coordinates without resolving them remotely. */
export const githubRepositoryScope: GithubRepositoryScopeClassifier = (arguments_) => {
  const repositories: AgentToolRepositoryTarget[] = [];
  addRepositoryCoordinate(repositories, arguments_.owner, arguments_.repo);
  addRepositoryCoordinate(repositories, arguments_.base_owner, arguments_.base_repo);
  addRepositoryCoordinate(repositories, arguments_.head_owner, arguments_.head_repo);
  addRepositoryCoordinate(repositories, arguments_.repository_owner, arguments_.repository_name);

  if (typeof arguments_.repository === 'string') {
    const slashIndex = arguments_.repository.indexOf('/');
    if (
      slashIndex > 0 &&
      slashIndex === arguments_.repository.lastIndexOf('/') &&
      slashIndex < arguments_.repository.length - 1
    ) {
      repositories.push({
        owner: arguments_.repository.slice(0, slashIndex),
        name: arguments_.repository.slice(slashIndex + 1),
      });
    }
  }

  return repositories.length === 0
    ? {kind: 'connection'}
    : {kind: 'declared-targets', repositories};
};

function addRepositoryCoordinate(
  repositories: AgentToolRepositoryTarget[],
  owner: unknown,
  name: unknown,
): void {
  if (
    typeof owner === 'string' &&
    owner.length > 0 &&
    typeof name === 'string' &&
    name.length > 0
  ) {
    repositories.push({owner, name});
  }
}

const pageProperties = {
  page: integerSchema('Page number for pagination', {minimum: 1}),
  per_page: integerSchema('Results per page for pagination', {minimum: 1, maximum: 100}),
};

const issueReadMethods = [
  method('get', 'Get information about a specific issue.', 'read', false, scopes.issuesRead),
  method('get_comments', 'Get comments on a specific issue.', 'read', false, scopes.issuesRead),
  method(
    'get_sub_issues',
    'Get sub-issues for a specific issue.',
    'read',
    false,
    scopes.issuesRead,
  ),
  method(
    'get_parent',
    'Get the parent issue for a specific issue.',
    'read',
    false,
    scopes.issuesRead,
  ),
  method(
    'get_labels',
    'Get labels assigned to a specific issue.',
    'read',
    false,
    scopes.issuesRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const issueWriteMethods = [
  method('create', 'Create a new issue.', 'write', false, scopes.issuesWrite),
  method('update', 'Update an existing issue.', 'write', false, scopes.issuesWrite),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const subIssueIndirectTargetNote =
  'The opaque child and ordering IDs may refer to another repository in the GitHub installation.';

const subIssueWriteMethods = [
  method(
    'add',
    'Add a sub-issue to a parent issue.',
    'write',
    false,
    scopes.issuesWrite,
    githubRepositoryScope,
    subIssueIndirectTargetNote,
  ),
  method(
    'remove',
    'Remove a sub-issue from a parent issue.',
    'write',
    false,
    scopes.issuesWrite,
    githubRepositoryScope,
    subIssueIndirectTargetNote,
  ),
  method(
    'reprioritize',
    'Reprioritize a sub-issue under its parent issue.',
    'write',
    false,
    scopes.issuesWrite,
    githubRepositoryScope,
    subIssueIndirectTargetNote,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const pullRequestReadMethods = [
  method(
    'get',
    'Get information about a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  // The diff media type reads file contents, which GitHub gates on contents read. GitHub also
  // documents contents read as sufficient for the route on its own, so nothing else is declared.
  method(
    'get_diff',
    'Get the diff for a specific pull request.',
    'read',
    false,
    scopes.contentsRead,
  ),
  method(
    'get_status',
    'Get status information for a specific pull request.',
    'read',
    false,
    scopes.statusesRead,
  ),
  method(
    'get_files',
    'Get files changed in a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_commits',
    'Get commits in a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_review_comments',
    'Get review comments for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_review_threads',
    'Get review threads, their resolution state, and comments for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_reviews',
    'Get reviews for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  {
    // GitHub accepts pull_requests read or issues read for timeline comments. Keep both grants in
    // the catalog so the provider requirement remains visible to callers and diagnostics.
    ...method(
      'get_comments',
      'Get conversation comments for a specific pull request.',
      'read',
      false,
      scopes.pullRequestsRead,
    ),
    alternativeScopes: [scopes.issuesRead],
  },
  method(
    'get_check_runs',
    'Get check runs for the head commit of a pull request.',
    'read',
    false,
    scopes.checksRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const checkRunWriteMethods = [
  method(
    'create',
    'Create a check run for a commit in a GitHub repository.',
    'write',
    false,
    scopes.checksWrite,
  ),
  method(
    'update',
    'Update an existing check run in a GitHub repository.',
    'write',
    false,
    scopes.checksWrite,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

export const checkRunInputStatuses = ['queued', 'in_progress', 'completed'] as const;
export const checkRunInputConclusions = [
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'success',
  'skipped',
  'timed_out',
] as const;
export const checkRunOutputStatuses = [
  'queued',
  'in_progress',
  'completed',
  'waiting',
  'requested',
  'pending',
] as const;
export const checkRunOutputConclusions = [...checkRunInputConclusions, 'stale'] as const;
export const checkRunMutableFields = [
  'name',
  'details_url',
  'external_id',
  'status',
  'started_at',
  'conclusion',
  'completed_at',
  'output',
] as const;

const checkRunInputSchema = repositoryInputSchema(
  {
    method: methodSchema(checkRunWriteMethods, 'The check-run operation to perform'),
    check_run_id: integerSchema('The positive numeric ID of the check run to update', {
      minimum: 1,
    }),
    name: stringSchema('Stable display name for the check'),
    head_sha: stringSchema('Full, non-zero 40- or 64-character hexadecimal commit object ID'),
    details_url: stringSchema('Absolute HTTP or HTTPS link with more details'),
    external_id: stringSchema('Caller-owned correlation key'),
    status: enumSchema([...checkRunInputStatuses], 'Check-run lifecycle status'),
    started_at: stringSchema(
      'RFC 3339 timestamp when the check started; leap seconds are accepted only when the normalized UTC instant is 23:59:60 on June 30 or December 31',
    ),
    conclusion: enumSchema([...checkRunInputConclusions], 'Final check-run conclusion'),
    completed_at: stringSchema(
      'RFC 3339 timestamp when the check completed; leap seconds are accepted only when the normalized UTC instant is 23:59:60 on June 30 or December 31',
    ),
    output: objectSchema(
      {
        title: stringSchema('Check output title'),
        summary: stringSchema('Check output summary in GitHub Markdown'),
        text: stringSchema('Optional check output text in GitHub Markdown'),
      },
      ['title', 'summary'],
    ),
  },
  ['method'],
  {
    oneOf: [
      methodRequiredSchema('create', ['name', 'head_sha']),
      {
        properties: {method: {const: 'update'}},
        required: ['check_run_id'],
        anyOf: checkRunMutableFields.map((field) => ({required: [field]})),
      },
    ],
  },
);

const checkRunOutputSchema = objectSchema(
  {
    check_run: objectSchema(
      {
        id: integerSchema('Positive numeric check-run ID', {minimum: 1}),
        name: stringSchema('Check-run display name'),
        head_sha: stringSchema('Non-zero 40- or 64-character hexadecimal commit object ID'),
        external_id: nullableStringSchema('Caller-owned correlation key'),
        details_url: nullableStringSchema('Absolute HTTP or HTTPS details link'),
        html_url: stringSchema('GitHub check-run URL'),
        status: enumSchema([...checkRunOutputStatuses], 'GitHub check-run lifecycle status'),
        conclusion: nullableEnumSchema(
          [...checkRunOutputConclusions],
          'GitHub check-run conclusion',
        ),
        started_at: nullableStringSchema(
          'RFC 3339 start timestamp; leap seconds are accepted only when the normalized UTC instant is 23:59:60 on June 30 or December 31',
        ),
        completed_at: nullableStringSchema(
          'RFC 3339 completion timestamp; leap seconds are accepted only when the normalized UTC instant is 23:59:60 on June 30 or December 31',
        ),
      },
      [
        'id',
        'name',
        'head_sha',
        'external_id',
        'details_url',
        'html_url',
        'status',
        'conclusion',
        'started_at',
        'completed_at',
      ],
    ),
  },
  ['check_run'],
);

const pullRequestReviewWriteMethods = [
  method(
    'create',
    'Create a pending pull request review.',
    'write',
    false,
    scopes.pullRequestsWrite,
  ),
  method(
    'submit_pending',
    'Submit the latest pending pull request review.',
    'write',
    false,
    scopes.pullRequestsWrite,
  ),
  method(
    'delete_pending',
    'Delete the latest pending pull request review.',
    'write',
    false,
    scopes.pullRequestsWrite,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const reviewThreadIndirectTargetNote =
  'The review thread node may belong to any repository reachable by the GitHub installation.';

const pullRequestReviewThreadWriteMethods = [
  method(
    'resolve',
    'Resolve a pull request review thread.',
    'write',
    false,
    scopes.pullRequestsWrite,
    connectionRepositoryScope,
    reviewThreadIndirectTargetNote,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const actionsListMethods = [
  method('list_workflows', 'List workflows in a repository.', 'read', false, scopes.actionsRead),
  method(
    'list_workflow_runs',
    'List workflow runs in a repository or for a workflow.',
    'read',
    false,
    scopes.actionsRead,
  ),
  method('list_workflow_jobs', 'List jobs for a workflow run.', 'read', false, scopes.actionsRead),
  method(
    'list_workflow_run_artifacts',
    'List artifacts for a workflow run.',
    'read',
    false,
    scopes.actionsRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const actionsGetMethods = [
  method('get_workflow', 'Get details for a workflow.', 'read', false, scopes.actionsRead),
  method('get_workflow_run', 'Get details for a workflow run.', 'read', false, scopes.actionsRead),
  method('get_workflow_job', 'Get details for a workflow job.', 'read', false, scopes.actionsRead),
  method(
    'download_workflow_run_artifact',
    'Download a workflow run artifact.',
    'read',
    false,
    scopes.actionsRead,
  ),
  method('get_workflow_run_usage', 'Get workflow run usage.', 'read', false, scopes.actionsRead),
  method(
    'get_workflow_run_logs_url',
    'Get a workflow run logs download URL.',
    'read',
    false,
    scopes.actionsRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const actionsRunTriggerMethods = [
  method('run_workflow', 'Trigger a workflow_dispatch run.', 'write', true, scopes.actionsWrite),
  method('rerun_workflow_run', 'Rerun a workflow run.', 'write', false, scopes.actionsWrite),
  method(
    'rerun_failed_jobs',
    'Rerun failed jobs in a workflow run.',
    'write',
    false,
    scopes.actionsWrite,
  ),
  method('cancel_workflow_run', 'Cancel a workflow run.', 'write', false, scopes.actionsWrite),
  method(
    'delete_workflow_run_logs',
    'Delete logs for a workflow run.',
    'write',
    true,
    scopes.actionsWrite,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const pullRequestWarningsSchema = arraySchema(
  stringSchema('A setting that could not be applied after the pull request was saved'),
);

const repositoryNameSchema = stringSchema(
  'Repository in owner/name format. Must be a repository the connection can access.',
);

const commitIdentitySchema = objectSchema(
  {
    login: nullableStringSchema('GitHub login of the matching account, or null'),
    name: nullableStringSchema('Name recorded in the commit'),
    email: nullableStringSchema('Email recorded in the commit'),
    date: nullableStringSchema('RFC 3339 timestamp recorded in the commit'),
  },
  ['login', 'name', 'email', 'date'],
);

const commitOutputSchema = objectSchema(
  {
    oid: stringSchema('The oid of the commit'),
    url: stringSchema('The URL of the commit'),
    message: stringSchema('The commit message'),
    parents: arraySchema(stringSchema('The oid of a parent commit')),
    author: commitIdentitySchema,
    committer: commitIdentitySchema,
    verified: booleanSchema('Whether GitHub verified the commit signature'),
  },
  ['oid', 'message', 'parents', 'author', 'committer', 'verified'],
);

export const githubAgentToolCatalog = [
  tool({
    id: 'issue_read',
    category: 'issues',
    description: 'Get information about a specific issue in a GitHub repository.',
    methods: issueReadMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(issueReadMethods, 'The read operation to perform on a single issue'),
        issue_number: integerSchema('The number of the issue'),
        ...pageProperties,
      },
      ['method', 'issue_number'],
    ),
    outputSchema: openObjectSchema('Issue read result'),
  }),
  tool({
    id: 'list_issue_types',
    category: 'issues',
    description:
      'List the issue types available to a GitHub repository. Issue types are defined by the owning organization, so the result also describes the organization.',
    sensitivity: 'read',
    sensitive: false,
    // The repository endpoint needs only the implicit metadata grant. Issues read is the
    // narrowest catalog permission that every installation using issue tools already holds.
    requiredScope: scopes.issuesRead,
    inputSchema: repositoryInputSchema(),
    outputSchema: objectSchema({issue_types: arraySchema(openObjectSchema('Issue type'))}, [
      'issue_types',
    ]),
  }),
  tool({
    id: 'list_issues',
    category: 'issues',
    description:
      "List issues in a GitHub repository. For pagination, use the 'endCursor' from the previous response's 'pageInfo' in the 'after' parameter.",
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    inputSchema: repositoryInputSchema({
      state: enumSchema(['OPEN', 'CLOSED'], 'Filter by state'),
      labels: arraySchema(stringSchema('Label name')),
      orderBy: enumSchema(['CREATED_AT', 'UPDATED_AT', 'COMMENTS'], 'Order issues by field'),
      direction: enumSchema(['ASC', 'DESC'], 'Order direction'),
      since: stringSchema('Filter by date (ISO 8601 timestamp)'),
      after: stringSchema('Pagination cursor'),
      first: integerSchema('Number of issues to return', {minimum: 1, maximum: 100}),
    }),
    outputSchema: objectSchema({issues: arraySchema(openObjectSchema('GitHub issue'))}, ['issues']),
  }),
  tool({
    id: 'search_issues',
    category: 'issues',
    description:
      'Search for issues in GitHub repositories using issues search syntax already scoped to is:issue. Provide owner and repo together for a repository-scoped search; omit both for a connection-scoped search. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    repositoryScope: searchRepositoryScope,
    inputSchema: objectSchema(
      {
        query: stringSchema(
          'Search query using GitHub issues search syntax. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
        ),
        owner: stringSchema(
          'Optional repository owner. Provide together with repo, or omit both for a connection-scoped search.',
        ),
        repo: stringSchema(
          'Optional repository name. Provide together with owner, or omit both for a connection-scoped search.',
        ),
        sort: enumSchema(
          [
            'comments',
            'reactions',
            'reactions-+1',
            'reactions--1',
            'reactions-smile',
            'reactions-thinking_face',
            'reactions-heart',
            'reactions-tada',
            'interactions',
            'created',
            'updated',
          ],
          'Sort field',
        ),
        order: enumSchema(['asc', 'desc'], 'Sort order'),
        ...pageProperties,
      },
      ['query'],
      searchRepositoryPairConstraints(),
    ),
    outputSchema: objectSchema({issues: arraySchema(openObjectSchema('GitHub issue'))}, ['issues']),
  }),
  tool({
    id: 'add_issue_comment',
    category: 'issues',
    description:
      'Add a comment and/or reaction to a specific issue or issue comment in a GitHub repository. Use this tool with pull requests as well, but only if the user is not asking specifically to add or react to review comments. At least one of body or reaction is required.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.issueAndPullRequestCommentsWrite,
    inputSchema: repositoryInputSchema(
      {
        issue_number: integerSchema('Issue or pull request number to comment on or react to'),
        comment_id: integerSchema(
          'The numeric ID of the issue or pull request comment to react to',
        ),
        body: stringSchema('Comment content. Required unless reaction is provided'),
        reaction: enumSchema(
          ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'],
          'Emoji reaction to add. Required unless body is provided',
        ),
      },
      [],
      {
        anyOf: [
          {required: ['issue_number', 'body']},
          {required: ['issue_number', 'reaction']},
          {required: ['comment_id', 'reaction']},
        ],
      },
    ),
    outputSchema: openObjectSchema('Created issue comment or reaction'),
  }),
  tool({
    id: 'issue_write',
    category: 'issues',
    description: 'Create a new or update an existing issue in a GitHub repository.',
    methods: issueWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(issueWriteMethods, 'Write operation to perform on a single issue'),
        issue_number: integerSchema('Issue number to update'),
        title: stringSchema('Issue title'),
        body: stringSchema('Issue body content'),
        assignees: arraySchema(stringSchema('GitHub username')),
        labels: arraySchema(stringSchema('Label name')),
        milestone: integerSchema('Milestone number'),
        issue_type: stringSchema('Type of this issue'),
        state: enumSchema(['open', 'closed'], 'New state'),
        state_reason: enumSchema(
          ['completed', 'not_planned', 'duplicate'],
          'Reason for the state change',
        ),
        duplicate_of: integerSchema('Issue number that this issue is a duplicate of'),
      },
      ['method'],
    ),
    outputSchema: openObjectSchema('Issue write result'),
  }),
  tool({
    id: 'sub_issue_write',
    category: 'issues',
    description:
      'Add, remove, or reprioritize a sub-issue under a parent issue in a GitHub repository.',
    methods: subIssueWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(subIssueWriteMethods, 'The action to perform on a single sub-issue'),
        issue_number: integerSchema('The number of the parent issue'),
        sub_issue_id: integerSchema('The ID of the sub-issue'),
        replace_parent: booleanSchema("Replace the sub-issue's current parent issue"),
        after_id: integerSchema('The ID of the sub-issue to be prioritized after'),
        before_id: integerSchema('The ID of the sub-issue to be prioritized before'),
      },
      ['method', 'issue_number', 'sub_issue_id'],
    ),
    outputSchema: openObjectSchema('Sub-issue write result'),
    indirectTargetNote:
      'The opaque child and ordering IDs may refer to another repository in the GitHub installation.',
  }),
  tool({
    id: 'pull_request_read',
    category: 'pull_requests',
    description: 'Get information on a specific pull request in a GitHub repository.',
    methods: pullRequestReadMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(
          pullRequestReadMethods,
          'Action to specify what pull request data needs to be retrieved from GitHub',
        ),
        pull_number: integerSchema('Pull request number'),
        ref: stringSchema('Git reference to inspect. Required for get_status and get_check_runs'),
        cursor: stringSchema('Cursor for review comment pagination'),
        ...pageProperties,
      },
      ['method', 'pull_number'],
      {
        oneOf: [
          methodRequiredSchema('get', []),
          methodRequiredSchema('get_diff', []),
          methodRequiredSchema('get_status', ['ref']),
          methodRequiredSchema('get_files', []),
          methodRequiredSchema('get_commits', []),
          methodRequiredSchema('get_review_comments', []),
          methodRequiredSchema('get_review_threads', []),
          methodRequiredSchema('get_reviews', []),
          methodRequiredSchema('get_comments', []),
          methodRequiredSchema('get_check_runs', ['ref']),
        ],
      },
    ),
    outputSchema: openObjectSchema('Pull request read result'),
  }),
  tool({
    id: 'check_run_write',
    category: 'checks',
    description: 'Create or update a check run for a commit in a GitHub repository.',
    methods: checkRunWriteMethods,
    inputSchema: checkRunInputSchema,
    outputSchema: checkRunOutputSchema,
  }),
  tool({
    id: 'list_pull_requests',
    category: 'pull_requests',
    description:
      'List pull requests in a GitHub repository. If the user specifies an author, then do not use this tool and use the search_pull_requests tool instead.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.pullRequestsRead,
    inputSchema: repositoryInputSchema({
      state: enumSchema(['open', 'closed', 'all'], 'Filter by state'),
      head: stringSchema('Filter by head user/org and branch'),
      base: stringSchema('Filter by base branch'),
      sort: enumSchema(['created', 'updated', 'popularity', 'long-running'], 'Sort by'),
      direction: enumSchema(['asc', 'desc'], 'Sort direction'),
      ...pageProperties,
    }),
    outputSchema: objectSchema(
      {pull_requests: arraySchema(openObjectSchema('GitHub pull request'))},
      ['pull_requests'],
    ),
  }),
  tool({
    id: 'search_pull_requests',
    category: 'pull_requests',
    description:
      'Search for pull requests in GitHub repositories using issues search syntax already scoped to is:pr. Provide owner and repo together for a repository-scoped search; omit both for a connection-scoped search. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.pullRequestsRead,
    repositoryScope: searchRepositoryScope,
    inputSchema: objectSchema(
      {
        query: stringSchema(
          'Search query using GitHub pull request search syntax. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
        ),
        owner: stringSchema(
          'Optional repository owner. Provide together with repo, or omit both for a connection-scoped search.',
        ),
        repo: stringSchema(
          'Optional repository name. Provide together with owner, or omit both for a connection-scoped search.',
        ),
        sort: enumSchema(
          [
            'comments',
            'reactions',
            'reactions-+1',
            'reactions--1',
            'reactions-smile',
            'reactions-thinking_face',
            'reactions-heart',
            'reactions-tada',
            'interactions',
            'created',
            'updated',
          ],
          'Sort field',
        ),
        order: enumSchema(['asc', 'desc'], 'Sort order'),
        ...pageProperties,
      },
      ['query'],
      searchRepositoryPairConstraints(),
    ),
    outputSchema: objectSchema(
      {pull_requests: arraySchema(openObjectSchema('GitHub pull request'))},
      ['pull_requests'],
    ),
  }),
  tool({
    id: 'create_pull_request',
    category: 'pull_requests',
    description:
      'Create a new pull request in a GitHub repository. Reviewers, labels, assignees, and the milestone are applied after the pull request is created. When one of them fails, the call still succeeds and the result lists the failure under warnings, because the pull request already exists and a retry would open a duplicate. On failure, the error reason is one of: pull-request-exists, no-commits-between, branch-not-found, permission-denied, unprocessable.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        title: stringSchema('PR title'),
        body: stringSchema('PR description'),
        head: stringSchema('Branch containing changes'),
        base: stringSchema('Branch to merge into'),
        draft: booleanSchema('Create as draft PR'),
        maintainer_can_modify: booleanSchema('Allow maintainer edits'),
        reviewers: arraySchema(stringSchema('GitHub username or ORG/team-slug reviewer')),
        labels: arraySchema(stringSchema('Name of a label to add')),
        assignees: arraySchema(stringSchema('GitHub username to assign')),
        milestone: integerSchema('Number of the milestone to set', {minimum: 1}),
      },
      ['title', 'head', 'base'],
    ),
    outputSchema: objectSchema(
      {
        pull_request: openObjectSchema('Created GitHub pull request'),
        warnings: pullRequestWarningsSchema,
      },
      ['pull_request'],
    ),
  }),
  tool({
    id: 'create_commit',
    category: 'repository',
    description:
      "Create a commit on a branch of a GitHub repository from a list of tree entries, with file modes, symbolic links, and submodules. The commit is signed by GitHub on behalf of the Shipfox bot (shipfox-ai[bot]) and shows the Verified badge. Entries are applied on top of the tree of parent_oid, which becomes the commit's only parent and must be a commit GitHub already has. Each entry names a path and exactly one of: contents (inline text), oid (a blob from create_blob, an existing blob, or a submodule commit), or delete. A rename is a delete of the old path plus an entry for the new path. A symbolic link uses mode 120000 with the link target as contents. The branch is created when it does not exist. Otherwise it must fast-forward to the new commit: if it moved, the commit is rejected with a stale-head error and the call should be retried from the new head. With force, the branch is reset to the new commit whatever it pointed at. Set expected_head_oid to the head you saw to guard either move: the call fails with a stale-head error when the branch points elsewhere or does not exist. GitHub offers no atomic compare for a ref update, so a push that lands between that check and the update is not detected, and a forced move overwrites it. Branch protection rules are the only barrier to writing the default branch. On failure, the error reason is one of: stale-head, protected-branch, permission-denied, unprocessable.",
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.contentsWrite,
    inputSchema: objectSchema(
      {
        repository: stringSchema(
          'Repository in owner/name format. Must be a repository the connection can access.',
        ),
        branch: stringSchema('The name of the branch to move, without any refs/ prefix'),
        parent_oid: stringSchema(
          'The commit oid (40 or 64 hexadecimal characters) the new commit is built on',
        ),
        message: stringSchema('Commit message. The first line is the headline.'),
        entries: arraySchema(
          objectSchema(
            {
              path: stringSchema('Repository-relative file path'),
              mode: enumSchema(
                [...GIT_TREE_ENTRY_MODES],
                'Git file mode: 100644 file (default), 100755 executable, 120000 symbolic link, 160000 submodule',
              ),
              contents: stringSchema('Inline text contents, or the target of a symbolic link'),
              oid: stringSchema('The oid of a blob, or of the commit a submodule points at'),
              delete: booleanSchema('Remove the path from the tree'),
            },
            ['path'],
          ),
        ),
        expected_head_oid: stringSchema(
          'The commit oid the branch is expected to point at before it moves. Checked just before the update.',
        ),
        force: booleanSchema(
          'Reset the branch to the new commit instead of requiring a fast-forward (default false)',
        ),
      },
      ['repository', 'branch', 'parent_oid', 'message', 'entries'],
    ),
    outputSchema: objectSchema(
      {
        commit: objectSchema(
          {
            oid: stringSchema('The oid of the created commit'),
            url: stringSchema('The URL of the created commit'),
            verified: booleanSchema('Whether GitHub signed the commit'),
          },
          ['oid', 'url', 'verified'],
        ),
        branch: stringSchema('The branch that now points at the commit'),
      },
      ['commit', 'branch'],
    ),
  }),
  tool({
    id: 'update_pull_request',
    category: 'pull_requests',
    description:
      'Update an existing pull request in a GitHub repository. add_labels and add_assignees add to what the pull request already has and remove nothing. milestone sets the milestone. draft true converts an open pull request to a draft, and draft false marks it ready for review. These and reviewers are applied after the update itself. When one of them fails, the call still succeeds and the result lists the failure under warnings. On failure, the error reason is one of: permission-denied, unprocessable.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number to update'),
        title: stringSchema('New title'),
        body: stringSchema('New description'),
        state: enumSchema(['open', 'closed'], 'New state'),
        base: stringSchema('New base branch name'),
        maintainer_can_modify: booleanSchema('Allow maintainer edits'),
        reviewers: arraySchema(stringSchema('GitHub username or ORG/team-slug reviewer')),
        add_labels: arraySchema(stringSchema('Name of a label to add')),
        add_assignees: arraySchema(stringSchema('GitHub username to assign')),
        milestone: integerSchema('Number of the milestone to set', {minimum: 1}),
        draft: booleanSchema('Convert to a draft (true) or mark ready for review (false)'),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema(
      {
        pull_request: openObjectSchema('Updated GitHub pull request'),
        warnings: pullRequestWarningsSchema,
      },
      ['pull_request'],
    ),
  }),
  tool({
    id: 'add_reply_to_pull_request_comment',
    category: 'pull_requests',
    description:
      'Add a reply and/or reaction to an existing pull request comment. This can create a new comment linked as a reply to the specified comment, add an emoji reaction to the specified comment, or do both. At least one of body or reaction is required.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number. Required when body is provided'),
        comment_id: integerSchema(
          'The numeric ID of the pull request review comment to reply or react to',
        ),
        body: stringSchema('The text of the reply'),
        reaction: enumSchema(
          ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'],
          'Emoji reaction to add',
        ),
      },
      ['comment_id'],
      {anyOf: [{required: ['pull_number', 'body']}, {required: ['reaction']}]},
    ),
    outputSchema: openObjectSchema('Pull request comment reply or reaction result'),
  }),
  tool({
    id: 'merge_pull_request',
    category: 'pull_requests',
    description: 'Merge a pull request in a GitHub repository.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: scopes.mergePullRequest,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number'),
        commit_title: stringSchema('Title for merge commit'),
        commit_message: stringSchema('Extra detail for merge commit'),
        merge_method: enumSchema(['merge', 'squash', 'rebase'], 'Merge method'),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema({merge: openObjectSchema('Merge result')}, ['merge']),
  }),
  tool({
    id: 'update_pull_request_branch',
    category: 'pull_requests',
    description:
      'Update the branch of a pull request with the latest changes from the base branch.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.mergePullRequest,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number'),
        expected_head_sha: stringSchema("The expected SHA of the pull request's HEAD ref"),
      },
      ['pull_number'],
    ),
    outputSchema: openObjectSchema('Pull request branch update result'),
    indirectTargetNote:
      'GitHub can also update the pull request head branch, which may belong to another repository.',
  }),
  tool({
    id: 'pull_request_review_write',
    category: 'pull_requests',
    description:
      'Stage, submit, or delete a pull request review. create opens a pending review, add_comment_to_pending_review attaches inline comments to it, and submit_pending publishes it with its summary.',
    methods: pullRequestReviewWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(
          pullRequestReviewWriteMethods,
          'The write operation to perform on pull request review',
        ),
        pull_number: integerSchema('Pull request number'),
        body: stringSchema(
          'Review summary text. Required by submit_pending unless event is APPROVE; not accepted by delete_pending',
        ),
        event: enumSchema(
          ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
          'Review action. Required by submit_pending; not accepted by create or delete_pending',
        ),
        commit_id: stringSchema('SHA of the commit to review. Only accepted by create'),
      },
      ['method', 'pull_number'],
    ),
    outputSchema: openObjectSchema('Pull request review write result'),
  }),
  tool({
    id: 'pull_request_review_thread_write',
    category: 'pull_requests',
    description:
      'Resolve a pull request review thread by opaque node ID. This operation is connection-scoped because the node ID does not declare a repository.',
    methods: pullRequestReviewThreadWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(
          pullRequestReviewThreadWriteMethods,
          'The write operation to perform on a pull request review thread',
        ),
        thread_id: stringSchema('The node ID of the review thread'),
      },
      ['method', 'thread_id'],
    ),
    outputSchema: openObjectSchema('Pull request review thread write result'),
    repositoryScope: connectionRepositoryScope,
    indirectTargetNote:
      'The review thread node may belong to any repository reachable by the GitHub installation.',
  }),
  tool({
    id: 'add_comment_to_pending_review',
    category: 'pull_requests',
    description:
      "Add a review comment to the requester's latest pending pull request review. The comment remains part of that pending review until it is submitted; a pending review needs to already exist to call this.",
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number'),
        path: stringSchema('The relative path to the file that necessitates a comment'),
        body: stringSchema('The text of the review comment'),
        subject_type: enumSchema(
          ['LINE', 'FILE'],
          'The level at which the comment is targeted. LINE (default) requires line and side; FILE accepts no position fields',
        ),
        line: integerSchema('The line of the blob in the pull request diff. Required for LINE'),
        side: enumSchema(
          ['LEFT', 'RIGHT'],
          'The side of the diff to comment on. Required for LINE',
        ),
        start_line: integerSchema(
          'The first line of a multi-line comment range. Must be lower than line and paired with start_side',
        ),
        start_side: enumSchema(
          ['LEFT', 'RIGHT'],
          'The starting side of a multi-line comment range. Paired with start_line',
        ),
      },
      ['pull_number', 'path', 'body'],
    ),
    outputSchema: openObjectSchema('Pending review comment result'),
  }),
  tool({
    id: 'actions_list',
    category: 'actions',
    description:
      'Tools for listing GitHub Actions resources. Use this tool to list workflows in a repository, or list workflow runs, jobs, and artifacts for a specific workflow or workflow run.',
    methods: actionsListMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(actionsListMethods, 'The action to perform'),
        resource_id: stringSchema('The unique identifier of the resource'),
        workflow_runs_filter: openObjectSchema('Filters for workflow runs'),
        workflow_jobs_filter: openObjectSchema('Filters for workflow jobs'),
        ...pageProperties,
      },
      ['method'],
    ),
    outputSchema: openObjectSchema('Actions list result'),
  }),
  tool({
    id: 'actions_get',
    category: 'actions',
    description:
      'Get details about specific GitHub Actions resources. Use this tool to get details about individual workflows, workflow runs, jobs, and artifacts by their unique IDs.',
    methods: actionsGetMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(actionsGetMethods, 'The method to execute'),
        resource_id: stringSchema('The unique identifier of the resource'),
      },
      ['method', 'resource_id'],
    ),
    outputSchema: openObjectSchema('Actions get result'),
  }),
  tool({
    id: 'actions_run_trigger',
    category: 'actions',
    description:
      'Trigger GitHub Actions workflow operations, including running, re-running, cancelling workflow runs, and deleting workflow run logs.',
    methods: actionsRunTriggerMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(actionsRunTriggerMethods, 'The method to execute'),
        workflow_id: stringSchema(
          'The workflow ID or workflow file name. Required for run_workflow',
        ),
        ref: stringSchema('The git reference for the workflow. Required for run_workflow'),
        inputs: openObjectSchema('Inputs the workflow accepts. Only used for run_workflow'),
        run_id: integerSchema(
          'The ID of the workflow run. Required for all methods except run_workflow',
        ),
      },
      ['method'],
      {
        oneOf: [
          methodRequiredSchema('run_workflow', ['workflow_id', 'ref']),
          methodRequiredSchema('rerun_workflow_run', ['run_id']),
          methodRequiredSchema('rerun_failed_jobs', ['run_id']),
          methodRequiredSchema('cancel_workflow_run', ['run_id']),
          methodRequiredSchema('delete_workflow_run_logs', ['run_id']),
        ],
      },
    ),
    outputSchema: openObjectSchema('Actions run trigger result'),
  }),
  tool({
    id: 'get_job_logs',
    category: 'actions',
    description:
      'Get logs for GitHub Actions workflow jobs. Use this tool to retrieve logs for a specific job or all failed jobs in a workflow run. For single job logs, provide job_id. For all failed jobs in a run, provide run_id with failed_only=true.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema({
      job_id: numberSchema(
        'The unique identifier of the workflow job. Required when getting logs for a single job.',
      ),
      run_id: numberSchema(
        'The unique identifier of the workflow run. Required when failed_only is true to get logs for all failed jobs in the run.',
      ),
      failed_only: booleanSchema(
        'When true, gets logs for all failed jobs in the workflow run specified by run_id. Requires run_id to be provided.',
      ),
      return_content: booleanSchema('Returns actual log content instead of URLs'),
      tail_lines: {
        ...numberSchema('Number of lines to return from the end of the log'),
        default: DEFAULT_JOB_LOG_TAIL_LINES,
      },
    }),
    outputSchema: openObjectSchema('GitHub Actions workflow job logs'),
  }),
  tool({
    id: 'create_branch',
    category: 'repository',
    description:
      'Create a branch in a GitHub repository pointing at a commit. Provide `from` as a 40- or 64-character commit oid (for example, the checkout commit of a step) or as an existing branch name, which the server resolves to its current head at call time. An existing branch is reused when it already points at the requested commit, and rejected otherwise. Creating a branch fires GitHub push-event workflows from the new ref, so only branch from commits you intend to activate. On failure, the error reason is one of: branch-exists, branch-not-found, protected-branch, permission-denied, unprocessable.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.contentsWrite,
    inputSchema: objectSchema(
      {
        repository: stringSchema('The repository in owner/name form'),
        branch: stringSchema('The name of the branch to create, without any refs/ prefix'),
        from: stringSchema(
          'The 40- or 64-character commit oid or existing branch name the new branch points at',
        ),
      },
      ['repository', 'branch', 'from'],
    ),
    outputSchema: objectSchema(
      {
        branch: stringSchema('The name of the created branch'),
        oid: stringSchema('The commit oid the created branch points at'),
        url: stringSchema('The API URL of the created git ref'),
      },
      ['branch', 'oid', 'url'],
    ),
  }),
  tool({
    id: 'create_blob',
    category: 'repository',
    description:
      'Upload the contents of one file to a GitHub repository as a Git blob and return its oid. The blob is not part of any commit until create_commit references it. Use it for binary files and for files too large to send inline; text is sent as utf8 and binary contents as base64. One file may hold up to 40 MiB.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.contentsWrite,
    inputSchema: objectSchema(
      {
        repository: stringSchema(
          'Repository in owner/name format. Must be a repository the connection can access.',
        ),
        contents: stringSchema('File contents'),
        encoding: enumSchema(['utf8', 'base64'], 'Contents encoding (default utf8)'),
      },
      ['repository', 'contents'],
    ),
    outputSchema: objectSchema({oid: stringSchema('The oid of the created blob')}, ['oid']),
  }),
  tool({
    id: 'delete_branch',
    category: 'repository',
    description:
      "Delete a branch of a GitHub repository. A branch that is already gone is a success with existed false, so the call is safe to retry. The repository's default branch is refused. Set expected_head_oid to delete the branch only while it points at that commit: the call fails with a stale-head error when it points elsewhere. GitHub offers no atomic compare for a ref deletion, so a push that lands between that check and the deletion is lost. Deleting the head branch of an open pull request closes the pull request. On failure, the error reason is one of: stale-head, protected-branch, permission-denied, unprocessable.",
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.contentsWrite,
    inputSchema: objectSchema(
      {
        repository: stringSchema(
          'Repository in owner/name format. Must be a repository the connection can access.',
        ),
        branch: stringSchema('The name of the branch to delete, without any refs/ prefix'),
        expected_head_oid: stringSchema(
          'The commit oid the branch is expected to point at. Checked just before the deletion.',
        ),
      },
      ['repository', 'branch'],
    ),
    outputSchema: objectSchema(
      {
        branch: stringSchema('The name of the branch'),
        existed: booleanSchema('Whether the branch existed and was deleted by this call'),
        oid: nullableStringSchema('The commit oid the branch pointed at, or null when it was gone'),
      },
      ['branch', 'existed', 'oid'],
    ),
  }),
  tool({
    id: 'get_repository',
    category: 'repository',
    description:
      'Get a GitHub repository: its full name, its default branch, and bot_login, the GitHub login of the Shipfox bot on this connection. Commits made by create_commit carry that login as their author, so compare it with the author login of a commit to tell bot commits from others.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.contentsRead,
    inputSchema: objectSchema({repository: repositoryNameSchema}, ['repository']),
    outputSchema: objectSchema(
      {
        full_name: stringSchema('Repository in owner/name format'),
        default_branch: stringSchema('The name of the default branch'),
        private: booleanSchema('Whether the repository is private'),
        url: stringSchema('The URL of the repository'),
        bot_login: stringSchema('The GitHub login of the Shipfox bot, for example shipfox-ai[bot]'),
      },
      ['full_name', 'default_branch', 'private', 'bot_login'],
    ),
  }),
  tool({
    id: 'get_branch',
    category: 'repository',
    description:
      'Get the head of a branch in a GitHub repository. A branch that does not exist is a success with exists false, so it can be told apart from a failed call.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.contentsRead,
    inputSchema: objectSchema(
      {
        repository: repositoryNameSchema,
        branch: stringSchema('The name of the branch, without any refs/ prefix'),
      },
      ['repository', 'branch'],
    ),
    outputSchema: objectSchema(
      {
        branch: stringSchema('The name of the branch'),
        exists: booleanSchema('Whether the branch exists'),
        oid: nullableStringSchema('The commit oid the branch points at, or null when missing'),
        protected: booleanSchema('Whether branch protection applies to the branch'),
      },
      ['branch', 'exists', 'oid', 'protected'],
    ),
  }),
  tool({
    id: 'get_commit',
    category: 'repository',
    description:
      'Get one commit of a GitHub repository by oid, branch, or tag: its parents, message, author, committer, and whether GitHub verified its signature. The author and committer login is the GitHub account matching the commit email, or null when no account matches.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.contentsRead,
    inputSchema: objectSchema(
      {
        repository: repositoryNameSchema,
        ref: stringSchema('A commit oid, branch name, or tag name'),
      },
      ['repository', 'ref'],
    ),
    outputSchema: objectSchema({commit: commitOutputSchema}, ['commit']),
  }),
  tool({
    id: 'compare_commits',
    category: 'repository',
    description:
      'List the commits a head has on top of a base in a GitHub repository, oldest first, with how far the head is ahead and behind and the merge base. Base and head are commit oids, branch names, or tag names. A page holds up to 100 commits: when truncated is true, call again with the next page.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.contentsRead,
    inputSchema: objectSchema(
      {
        repository: repositoryNameSchema,
        base: stringSchema('The commit oid, branch, or tag to compare from'),
        head: stringSchema('The commit oid, branch, or tag to compare to'),
        page: integerSchema('Page of commits to return (default 1)', {minimum: 1}),
      },
      ['repository', 'base', 'head'],
    ),
    outputSchema: objectSchema(
      {
        status: enumSchema(
          ['ahead', 'behind', 'identical', 'diverged'],
          'How the head relates to the base',
        ),
        ahead_by: integerSchema('Commits the head has that the base lacks'),
        behind_by: integerSchema('Commits the base has that the head lacks'),
        merge_base_oid: nullableStringSchema('The oid of the merge base commit'),
        total_commits: integerSchema('Commits between the base and the head, on every page'),
        commits: arraySchema(commitOutputSchema),
        truncated: booleanSchema('Whether later pages hold more commits'),
      },
      [
        'status',
        'ahead_by',
        'behind_by',
        'merge_base_oid',
        'total_commits',
        'commits',
        'truncated',
      ],
    ),
  }),
] as const satisfies readonly GithubAgentToolCatalogEntry[];

export type GithubAgentToolId = (typeof githubAgentToolCatalog)[number]['id'];

export function buildGithubAgentToolSelectionCatalog(
  catalog: readonly GithubAgentToolCatalogEntry[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.flatMap((entry): AgentToolSelector[] => {
      if (!entry.methods) {
        return [
          {
            token: entry.id,
            kind: 'standalone',
            sensitivity: entry.sensitivity,
            sensitive: entry.sensitive,
          },
        ];
      }

      return [
        {
          token: entry.id,
          kind: 'family',
          sensitivity: entry.sensitivity,
          sensitive: entry.sensitive,
        },
        {
          token: `${entry.id}.*`,
          kind: 'family_wildcard',
          sensitivity: entry.sensitivity,
          sensitive: entry.sensitive,
        },
        ...entry.methods.map((method) => ({
          token: `${entry.id}.${method.id}`,
          kind: 'method' as const,
          sensitivity: method.sensitivity,
          sensitive: method.sensitive,
        })),
      ];
    }),
  };
}

export const githubAgentToolSelectionCatalog =
  buildGithubAgentToolSelectionCatalog(githubAgentToolCatalog);

function tool(input: GithubAgentToolCatalogInput): GithubAgentToolCatalogEntry {
  if (!input.methods) {
    if (!input.sensitivity || input.sensitive === undefined || !input.requiredScope) {
      throw new Error(`GitHub agent tool ${input.id} is missing sensitivity or required scope`);
    }
    return {
      id: input.id,
      category: input.category,
      description: input.description,
      sensitivity: input.sensitivity,
      sensitive: input.sensitive,
      requiredScope: input.requiredScope,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      repositoryScope: input.repositoryScope ?? githubRepositoryScope,
      ...(input.indirectTargetNote === undefined
        ? {}
        : {indirectTargetNote: input.indirectTargetNote}),
    };
  }

  return {
    id: input.id,
    category: input.category,
    description: input.description,
    sensitivity: input.methods.some((candidate) => candidate.sensitivity === 'write')
      ? 'write'
      : 'read',
    sensitive: input.methods.some((candidate) => candidate.sensitive),
    requiredScope: unionRequiredScopes(input.methods),
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    repositoryScope: input.repositoryScope ?? githubRepositoryScope,
    ...(input.indirectTargetNote === undefined
      ? {}
      : {indirectTargetNote: input.indirectTargetNote}),
    methods: input.methods,
  };
}

function method(
  id: string,
  description: string,
  sensitivity: GithubAgentToolSensitivity,
  sensitive: boolean,
  requiredScope: GithubAgentToolRequiredScope,
  repositoryScope: GithubRepositoryScopeClassifier = githubRepositoryScope,
  indirectTargetNote?: string,
): GithubAgentToolCatalogMethod {
  return {
    id,
    description,
    sensitivity,
    sensitive,
    requiredScope,
    repositoryScope,
    ...(indirectTargetNote === undefined ? {} : {indirectTargetNote}),
  };
}

function unionRequiredScopes(
  methods: readonly GithubAgentToolCatalogMethod[],
): GithubAgentToolRequiredScope {
  const byPermission = new Map<GithubAgentToolPermission, GithubAgentToolPermissionAccess>();

  for (const {requiredScope} of methods) {
    for (const {permission, access} of requiredScope) {
      if (byPermission.get(permission) === 'write') continue;
      byPermission.set(permission, access);
    }
  }

  return [...byPermission.entries()].map(([permission, access]) => ({permission, access}));
}

function repositoryInputSchema(
  properties: Record<string, AgentToolJsonSchema> = {},
  required: string[] = [],
  extraSchema: Partial<AgentToolJsonSchema> = {},
): AgentToolJsonSchema {
  return objectSchema(
    {...repositoryProperties, ...properties},
    ['owner', 'repo', ...required],
    extraSchema,
  );
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
  extraSchema: Partial<AgentToolJsonSchema> = {},
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
    ...extraSchema,
  };
}

function searchRepositoryPairConstraints(): Pick<AgentToolJsonSchema, 'oneOf'> {
  return {
    oneOf: [
      {properties: repositoryProperties, required: ['owner', 'repo']},
      {
        not: {
          anyOf: [
            {properties: repositoryProperties, required: ['owner']},
            {properties: repositoryProperties, required: ['repo']},
          ],
        },
      },
    ],
  };
}

function methodRequiredSchema(methodId: string, required: string[]): AgentToolJsonSchema {
  return {
    properties: {
      method: {const: methodId},
    },
    required,
  };
}

function openObjectSchema(description: string): AgentToolJsonSchema {
  return {type: 'object', description, additionalProperties: true};
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description ? {description} : {})};
}

function nullableStringSchema(description?: string): AgentToolJsonSchema {
  return {type: ['string', 'null'], ...(description ? {description} : {})};
}

function nullableEnumSchema(values: string[], description: string): AgentToolJsonSchema {
  return {type: ['string', 'null'], description, enum: [...values, null]};
}

function integerSchema(
  description?: string,
  options: {minimum?: number | undefined; maximum?: number | undefined} = {},
): AgentToolJsonSchema {
  return {type: 'integer', ...(description ? {description} : {}), ...options};
}

function numberSchema(description?: string): AgentToolJsonSchema {
  return {type: 'number', ...(description ? {description} : {})};
}

function booleanSchema(description: string): AgentToolJsonSchema {
  return {type: 'boolean', description};
}

function enumSchema(values: string[], description: string): AgentToolJsonSchema {
  return {type: 'string', description, enum: values};
}

function methodSchema(
  methods: readonly GithubAgentToolCatalogMethod[],
  description: string,
): AgentToolJsonSchema {
  return enumSchema(
    methods.map((candidate) => candidate.id),
    description,
  );
}

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}

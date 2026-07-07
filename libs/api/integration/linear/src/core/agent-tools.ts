import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-core-dto';

export type LinearAgentToolRequiredScope = 'read' | 'write';

export type LinearAgentToolCategory =
  | 'issues'
  | 'comments'
  | 'projects'
  | 'documents'
  | 'workspace'
  | 'cycles'
  | 'releases'
  | 'release_notes'
  | 'agents'
  | 'diffs'
  | 'attachments'
  | 'documentation';

export interface LinearAgentToolCatalogEntry
  extends AgentToolCatalogEntry<LinearAgentToolRequiredScope> {
  category: LinearAgentToolCategory;
}

interface LinearAgentToolCatalogInput {
  id: string;
  category: LinearAgentToolCategory;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: LinearAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
}

const orderBySchema = enumSchema(['createdAt', 'updatedAt'], 'Sort order');
const cursorSchema = stringSchema('Next page cursor');
const limitSchema = numberSchema('Maximum number of results to return');
const dateFilterSchema = stringSchema('ISO-8601 date or duration filter');
const prioritySchema = numberSchema('0=None, 1=Urgent, 2=High, 3=Medium, 4=Low');
const nullableStringSchema = nullableSchema(stringSchema());

const pageProperties = {
  cursor: cursorSchema,
  limit: limitSchema,
  orderBy: orderBySchema,
};

const timelineFilterProperties = {
  createdAt: dateFilterSchema,
  updatedAt: dateFilterSchema,
};

export const linearAgentToolCatalog = [
  tool({
    id: 'get_attachment',
    category: 'attachments',
    description: 'Retrieve a Linear attachment by ID.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({id: stringSchema('Attachment ID')}, ['id']),
  }),
  tool({
    id: 'get_agent_skill',
    category: 'agents',
    description: 'Retrieve a Linear Agent skill by ID, including its full markdown instructions.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({id: stringSchema('Agent skill ID')}, ['id']),
  }),
  tool({
    id: 'get_diff',
    category: 'diffs',
    description: 'Look up a Linear diff by review URL, GitHub PR URL, identifier, UUID, or slug.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        urlOrId: stringSchema(
          'Linear review URL, diff slug, pull request ID, Linear identifier, or GitHub PR URL',
        ),
      },
      ['urlOrId'],
    ),
  }),
  tool({
    id: 'get_diff_threads',
    category: 'diffs',
    description:
      'Look up Linear diff threads by review URL, GitHub PR URL, identifier, UUID, or slug.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        orderBy: orderBySchema,
        resolved: booleanSchema('Filter returned threads by resolved state'),
        threadId: stringSchema('Top-level thread or comment ID to return'),
        urlOrId: stringSchema(
          'Linear review URL, diff slug, pull request ID, Linear identifier, or GitHub PR URL',
        ),
      },
      ['urlOrId'],
    ),
  }),
  tool({
    id: 'get_document',
    category: 'documents',
    description: 'Retrieve a Linear document by ID or slug.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({id: stringSchema('Document ID or slug')}, ['id']),
  }),
  tool({
    id: 'get_issue',
    category: 'issues',
    description: 'Retrieve detailed information about a Linear issue.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        id: stringSchema('Issue ID or identifier'),
        includeCustomerNeeds: booleanSchema('Include associated customer needs'),
        includeRelations: booleanSchema('Include blocking, related, and duplicate relations'),
        includeReleases: booleanSchema('Include associated releases'),
      },
      ['id'],
    ),
  }),
  tool({
    id: 'list_issues',
    category: 'issues',
    description: 'List Linear issues visible to the authenticated connection.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      ...timelineFilterProperties,
      assignee: nullableStringSchema,
      cycle: stringSchema('Cycle name, number, or ID'),
      delegate: stringSchema('Agent name or ID'),
      includeArchived: booleanSchema('Include archived issues'),
      label: stringSchema('Label name or ID'),
      parentId: stringSchema('Parent issue ID or identifier'),
      priority: prioritySchema,
      project: stringSchema('Project name, ID, or slug'),
      query: stringSchema('Search issue title or description'),
      release: stringSchema('Release ID or slug'),
      state: stringSchema('State type, name, or ID'),
      team: stringSchema('Team name or ID'),
    }),
  }),
  tool({
    id: 'list_comments',
    category: 'comments',
    description: 'List comments on a Linear issue, project, initiative, document, or milestone.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      documentId: stringSchema('Document ID or slug'),
      initiativeId: stringSchema('Initiative name or ID'),
      issueId: stringSchema('Issue ID or identifier'),
      milestoneId: stringSchema('Milestone UUID'),
      projectId: stringSchema('Project name, ID, or slug'),
    }),
  }),
  tool({
    id: 'list_issue_labels',
    category: 'issues',
    description: 'List issue labels in a Linear workspace or team.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      name: stringSchema('Filter by label name'),
      team: stringSchema('Team name or ID'),
    }),
  }),
  tool({
    id: 'list_issue_statuses',
    category: 'issues',
    description: 'List available issue statuses in a Linear team.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({team: stringSchema('Team name or ID')}, ['team']),
  }),
  tool({
    id: 'get_issue_status',
    category: 'issues',
    description: 'Retrieve detailed information about an issue status by name or ID.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        id: stringSchema('Status ID'),
        name: stringSchema('Status name'),
        team: stringSchema('Team name or ID'),
      },
      ['id', 'name', 'team'],
    ),
  }),
  tool({
    id: 'list_teams',
    category: 'workspace',
    description: 'List teams in the Linear workspace.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      ...timelineFilterProperties,
      includeArchived: booleanSchema('Include archived teams'),
      query: stringSchema('Search query'),
    }),
  }),
  tool({
    id: 'get_team',
    category: 'workspace',
    description: 'Retrieve detailed information about a Linear team.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({query: stringSchema('Team UUID, key, or name')}, ['query']),
  }),
  tool({
    id: 'list_users',
    category: 'workspace',
    description: 'Retrieve users in the Linear workspace.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      query: stringSchema('Filter by name or email'),
      team: stringSchema('Team name or ID'),
    }),
  }),
  tool({
    id: 'list_projects',
    category: 'projects',
    description: 'List projects in the Linear workspace.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      ...timelineFilterProperties,
      includeArchived: booleanSchema('Include archived projects'),
      includeMembers: booleanSchema('Include project members'),
      includeMilestones: booleanSchema('Include milestones'),
      initiative: stringSchema('Initiative name or ID'),
      label: stringSchema('Label name or ID'),
      member: stringSchema('User ID, name, email, or "me"'),
      query: stringSchema('Search project name'),
      state: stringSchema('State type, name, or ID'),
      team: stringSchema('Team name or ID'),
    }),
  }),
  tool({
    id: 'get_project',
    category: 'projects',
    description: 'Retrieve details of a specific Linear project.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        includeMembers: booleanSchema('Include project members'),
        includeMilestones: booleanSchema('Include milestones'),
        includeResources: booleanSchema('Include documents, links, and attachments'),
        query: stringSchema('Project name, ID, or slug'),
      },
      ['query'],
    ),
  }),
  tool({
    id: 'list_project_labels',
    category: 'projects',
    description: 'List project labels in the Linear workspace.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      name: stringSchema('Filter by label name'),
    }),
  }),
  tool({
    id: 'list_milestones',
    category: 'projects',
    description: 'List milestones in a Linear project.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({project: stringSchema('Project name, ID, or slug')}, ['project']),
  }),
  tool({
    id: 'get_milestone',
    category: 'projects',
    description: 'Retrieve details of a Linear milestone by ID or name.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        project: stringSchema('Project name, ID, or slug'),
        query: stringSchema('Milestone name or ID'),
      },
      ['project', 'query'],
    ),
  }),
  tool({
    id: 'get_release',
    category: 'releases',
    description: 'Retrieve details of a Linear release by ID or slug.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        id: stringSchema('Release ID or slug'),
        includeReleaseNotes: booleanSchema('Include associated release notes'),
      },
      ['id'],
    ),
  }),
  tool({
    id: 'get_release_note',
    category: 'release_notes',
    description: 'Retrieve Linear release notes by ID or slug, including markdown content.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        id: stringSchema('Release notes ID or slug'),
        includeReleases: booleanSchema('Include associated releases'),
      },
      ['id'],
    ),
  }),
  tool({
    id: 'list_cycles',
    category: 'cycles',
    description: 'Retrieve cycles for a specific Linear team.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        teamId: stringSchema('Team ID'),
        type: enumSchema(['current', 'previous', 'next'], 'Cycle filter'),
      },
      ['teamId'],
    ),
  }),
  tool({
    id: 'list_documents',
    category: 'documents',
    description: 'List documents in the Linear workspace.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      ...timelineFilterProperties,
      creatorId: stringSchema('Creator ID'),
      includeArchived: booleanSchema('Include archived documents'),
      initiativeId: stringSchema('Initiative ID'),
      projectId: stringSchema('Project ID'),
      query: stringSchema('Search query'),
      teamId: stringSchema('Team ID'),
    }),
  }),
  tool({
    id: 'get_status_updates',
    category: 'projects',
    description: 'List or retrieve project or initiative status updates.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        ...pageProperties,
        ...timelineFilterProperties,
        id: stringSchema('Status update ID'),
        includeArchived: booleanSchema('Include archived updates'),
        initiative: stringSchema('Initiative name or ID'),
        project: stringSchema('Project name, ID, or slug'),
        type: enumSchema(['project', 'initiative'], 'Status update type'),
        user: stringSchema('User ID, name, email, or "me"'),
      },
      ['type'],
    ),
  }),
  tool({
    id: 'list_release_notes',
    category: 'release_notes',
    description: 'List release notes in the workspace, optionally filtered by pipeline or release.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      ...timelineFilterProperties,
      includeArchived: booleanSchema('Include archived release notes'),
      includeContent: booleanSchema('Include markdown release notes content'),
      includeReleases: booleanSchema('Include associated releases'),
      pipeline: stringSchema('Release pipeline ID, slug, or exact name'),
      query: stringSchema('Search release notes title'),
      release: stringSchema('Release ID or slug'),
    }),
  }),
  tool({
    id: 'list_release_pipelines',
    category: 'releases',
    description: 'List release pipelines in the Linear workspace.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      ...timelineFilterProperties,
      includeArchived: booleanSchema('Include archived release pipelines'),
      includeStages: booleanSchema('Include each pipeline stages'),
      includeTeams: booleanSchema('Include each pipeline teams'),
      isProduction: booleanSchema('Filter by production pipeline flag'),
      query: stringSchema('Search pipeline name'),
      team: stringSchema('Team name or ID'),
      type: enumSchema(['continuous', 'scheduled'], 'Pipeline type'),
    }),
  }),
  tool({
    id: 'list_releases',
    category: 'releases',
    description:
      'List releases in the workspace, with optional filtering by pipeline, stage, version, and text.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      ...timelineFilterProperties,
      hasReleaseNotes: booleanSchema('Filter to releases that do or do not have release notes'),
      includeArchived: booleanSchema('Include archived releases'),
      includeReleaseNotes: booleanSchema('Include associated release notes'),
      pipeline: stringSchema('Release pipeline ID, slug, or exact name'),
      query: stringSchema('Search release name or version'),
      stage: stringSchema('Release stage ID or exact name'),
      stageType: enumSchema(
        ['planned', 'started', 'completed', 'canceled'],
        'Stage lifecycle type',
      ),
      version: stringSchema('Exact version match'),
    }),
  }),
  tool({
    id: 'list_agent_skills',
    category: 'agents',
    description: 'List Linear Agent skills available to the authenticated user.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(pageProperties),
  }),
  tool({
    id: 'get_user',
    category: 'workspace',
    description: 'Retrieve details of a specific Linear user.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({query: stringSchema('User ID, name, email, or "me"')}, ['query']),
  }),
  tool({
    id: 'list_diffs',
    category: 'diffs',
    description: 'List Linear diff pull requests visible to the authenticated user.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      ...pageProperties,
      owner: stringSchema('Repository owner'),
      query: stringSchema('Search by title, branch, PR number, or bare slug'),
      repo: stringSchema('Repository name'),
      status: stringSchema('Pull request status'),
    }),
  }),
  tool({
    id: 'extract_images',
    category: 'attachments',
    description: 'Extract and fetch images from markdown content.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {markdown: stringSchema('Markdown content containing image references')},
      ['markdown'],
    ),
  }),
  tool({
    id: 'search_documentation',
    category: 'documentation',
    description: "Search Linear's documentation to learn about features and usage.",
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        page: numberSchema('Page number'),
        query: stringSchema('Search query'),
      },
      ['query'],
    ),
  }),
  tool({
    id: 'create_attachment',
    category: 'attachments',
    description: 'Upload a tiny file through the MCP worker and attach it to a Linear issue.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        base64Content: stringSchema('Deprecated base64-encoded file content to upload'),
        contentType: stringSchema('MIME type for the upload'),
        filename: stringSchema('Filename for the upload'),
        issue: stringSchema('Issue ID or identifier'),
        sha256: stringSchema('Expected SHA-256 hex digest of the decoded file bytes'),
        size: numberSchema('Expected decoded file size in bytes'),
        subtitle: stringSchema('Attachment subtitle'),
        title: stringSchema('Attachment title'),
      },
      ['base64Content', 'contentType', 'filename', 'issue', 'sha256'],
    ),
  }),
  tool({
    id: 'create_attachment_from_upload',
    category: 'attachments',
    description: 'Link an already-uploaded Linear asset URL to an existing issue as an attachment.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        assetUrl: stringSchema('Linear upload asset URL returned by prepare_attachment_upload'),
        issue: stringSchema('Issue ID or identifier'),
        subtitle: stringSchema('Attachment subtitle'),
        title: stringSchema('Attachment title'),
      },
      ['assetUrl', 'issue'],
    ),
  }),
  tool({
    id: 'prepare_attachment_upload',
    category: 'attachments',
    description: 'Prepare a direct Linear file upload for an existing issue.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        contentType: stringSchema('MIME type for the upload'),
        filename: stringSchema('Filename for the upload'),
        issue: stringSchema('Issue ID or identifier'),
        size: numberSchema('Exact file size in bytes'),
        subtitle: stringSchema('Suggested attachment subtitle for the finalize step'),
        title: stringSchema('Suggested attachment title for the finalize step'),
      },
      ['contentType', 'filename', 'issue', 'size'],
    ),
  }),
  tool({
    id: 'save_issue',
    category: 'issues',
    description: 'Create or update a Linear issue.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        addReleases: arraySchema(stringSchema('Release ID or slug')),
        assignee: nullableStringSchema,
        blockedBy: arraySchema(stringSchema('Blocking issue ID or identifier')),
        blocks: arraySchema(stringSchema('Blocked issue ID or identifier')),
        cycle: nullableStringSchema,
        delegate: nullableStringSchema,
        description: stringSchema('Issue description as Markdown'),
        dueDate: stringSchema('Due date in ISO format'),
        duplicateOf: nullableStringSchema,
        estimate: nullableSchema(numberSchema('Issue estimate value')),
        id: stringSchema('Issue ID or identifier'),
        labels: arraySchema(stringSchema('Label name or ID')),
        links: arraySchema(
          objectSchema(
            {
              title: stringSchema('Attachment title'),
              url: stringSchema('Attachment URL'),
            },
            ['title', 'url'],
          ),
        ),
        milestone: stringSchema('Milestone name or ID'),
        parentId: nullableStringSchema,
        priority: prioritySchema,
        project: nullableStringSchema,
        relatedTo: arraySchema(stringSchema('Related issue ID or identifier')),
        removeBlockedBy: arraySchema(stringSchema('Blocking issue ID or identifier to remove')),
        removeBlocks: arraySchema(stringSchema('Blocked issue ID or identifier to remove')),
        removeRelatedTo: arraySchema(stringSchema('Related issue ID or identifier to remove')),
        removeReleases: arraySchema(stringSchema('Release ID or slug to remove')),
        setReleases: arraySchema(stringSchema('Release ID or slug')),
        state: stringSchema('State type, name, or ID'),
        team: stringSchema('Team name or ID'),
        title: stringSchema('Issue title'),
      },
      [],
    ),
  }),
  tool({
    id: 'save_comment',
    category: 'comments',
    description:
      'Create or update a comment on a Linear issue, project, initiative, document, or milestone.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        body: stringSchema('Comment body as Markdown'),
        documentId: stringSchema('Document ID or slug'),
        id: stringSchema('Comment ID'),
        initiativeId: stringSchema('Initiative name or ID'),
        issueId: stringSchema('Issue ID or identifier'),
        milestoneId: stringSchema('Milestone UUID'),
        parentId: stringSchema('Parent comment ID'),
        projectId: stringSchema('Project name, ID, or slug'),
      },
      ['body'],
    ),
  }),
  tool({
    id: 'save_project',
    category: 'projects',
    description: 'Create or update a Linear project.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        addInitiatives: arraySchema(stringSchema('Initiative name or ID')),
        addTeams: arraySchema(stringSchema('Team name or ID')),
        color: stringSchema('Hex color'),
        description: stringSchema('Project description as Markdown'),
        icon: stringSchema('Icon name or emoji code'),
        id: stringSchema('Project ID'),
        labels: arraySchema(stringSchema('Label name or ID')),
        lead: nullableStringSchema,
        name: stringSchema('Project name'),
        priority: prioritySchema,
        removeInitiatives: arraySchema(stringSchema('Initiative name or ID')),
        removeTeams: arraySchema(stringSchema('Team name or ID')),
        setInitiatives: arraySchema(stringSchema('Initiative name or ID')),
        setTeams: arraySchema(stringSchema('Team name or ID')),
        startDate: stringSchema('Start date in ISO format'),
        startDateResolution: enumSchema(
          ['halfYear', 'month', 'quarter', 'year'],
          'Start date resolution',
        ),
        state: stringSchema('Project state'),
        summary: stringSchema('Short summary'),
        targetDate: stringSchema('Target date in ISO format'),
        targetDateResolution: enumSchema(
          ['halfYear', 'month', 'quarter', 'year'],
          'Target date resolution',
        ),
      },
      [],
    ),
  }),
  tool({
    id: 'save_document',
    category: 'documents',
    description: 'Create or update a Linear document.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        color: stringSchema('Hex color'),
        content: stringSchema('Document content as Markdown'),
        cycle: stringSchema('Cycle name, number, or ID'),
        icon: stringSchema('Icon name or emoji code'),
        id: stringSchema('Document ID or slug'),
        initiative: stringSchema('Initiative name or ID'),
        issue: stringSchema('Issue ID or identifier'),
        project: stringSchema('Project name, ID, or slug'),
        team: stringSchema('Team name or ID'),
        title: stringSchema('Document title'),
      },
      [],
    ),
  }),
  tool({
    id: 'save_milestone',
    category: 'projects',
    description: 'Create or update a Linear milestone in a project.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        description: stringSchema('Milestone description'),
        id: stringSchema('Milestone name or ID'),
        name: stringSchema('Milestone name'),
        project: stringSchema('Project name, ID, or slug'),
        targetDate: nullableStringSchema,
      },
      ['project'],
    ),
  }),
  tool({
    id: 'save_release',
    category: 'releases',
    description: 'Create or update a Linear release.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        commitSha: stringSchema('Commit SHA associated with the release'),
        completedAt: nullableSchema(stringSchema('Completed timestamp in ISO DateTime format')),
        createdAt: stringSchema('Import or create timestamp in ISO DateTime format'),
        description: stringSchema('Release description'),
        id: stringSchema('Release ID or slug to update'),
        name: stringSchema('Release name'),
        pipeline: stringSchema('Release pipeline ID, slug, or exact name'),
        stage: stringSchema('Release stage ID, exact name, or lifecycle type within the pipeline'),
        startDate: nullableSchema(stringSchema('Estimated start date in ISO YYYY-MM-DD format')),
        startedAt: nullableSchema(stringSchema('Started timestamp in ISO DateTime format')),
        targetDate: nullableSchema(
          stringSchema('Estimated completion date in ISO YYYY-MM-DD format'),
        ),
        version: stringSchema('Version identifier'),
      },
      [],
    ),
  }),
  tool({
    id: 'save_release_note',
    category: 'release_notes',
    description: 'Create or update Linear release notes.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        content: stringSchema('Release notes content as Markdown'),
        id: stringSchema('Release notes ID or slug to update'),
        pipeline: stringSchema('Release pipeline ID, slug, or exact name'),
        rangeFromRelease: stringSchema('Oldest release ID or slug in the note range'),
        rangeToRelease: stringSchema('Newest release ID or slug in the note range'),
        releases: arraySchema(stringSchema('Release ID or slug')),
        title: stringSchema('Release notes title'),
      },
      [],
    ),
  }),
  tool({
    id: 'save_status_update',
    category: 'projects',
    description: 'Create or update a project or initiative status update.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        body: stringSchema('Status update body as Markdown'),
        health: enumSchema(['onTrack', 'atRisk', 'offTrack'], 'Status update health'),
        id: stringSchema('Status update ID'),
        initiative: stringSchema('Initiative name or ID'),
        isDiffHidden: booleanSchema('Hide diff with previous update'),
        project: stringSchema('Project name, ID, or slug'),
        type: enumSchema(['project', 'initiative'], 'Status update type'),
      },
      ['type'],
    ),
  }),
  tool({
    id: 'create_issue_label',
    category: 'issues',
    description: 'Create a new Linear issue label.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        color: stringSchema('Hex color code'),
        description: stringSchema('Label description'),
        isGroup: booleanSchema('Is label group'),
        name: stringSchema('Label name'),
        parent: stringSchema('Parent label group name'),
        teamId: stringSchema('Team UUID'),
      },
      ['name'],
    ),
  }),
  tool({
    id: 'delete_comment',
    category: 'comments',
    description: 'Delete a Linear comment.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema({id: stringSchema('Comment ID')}, ['id']),
  }),
  tool({
    id: 'delete_status_update',
    category: 'projects',
    description: 'Delete or archive a Linear project or initiative status update.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        id: stringSchema('Status update ID'),
        type: enumSchema(['project', 'initiative'], 'Status update type'),
      },
      ['id', 'type'],
    ),
  }),
  tool({
    id: 'delete_attachment',
    category: 'attachments',
    description: 'Delete a Linear attachment.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: 'write',
    inputSchema: objectSchema({id: stringSchema('Attachment ID')}, ['id']),
  }),
] as const satisfies readonly LinearAgentToolCatalogEntry[];

export type LinearAgentToolId = (typeof linearAgentToolCatalog)[number]['id'];

export const linearAgentToolSelectionCatalog =
  buildLinearAgentToolSelectionCatalog(linearAgentToolCatalog);

function buildLinearAgentToolSelectionCatalog(
  catalog: readonly LinearAgentToolCatalogEntry[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.map(
      (entry): AgentToolSelector => ({
        token: entry.id,
        kind: 'standalone',
        sensitivity: entry.sensitivity,
        sensitive: entry.sensitive,
      }),
    ),
  };
}

function tool(input: LinearAgentToolCatalogInput): LinearAgentToolCatalogEntry {
  return input;
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

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description ? {description} : {})};
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

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}

function nullableSchema(schema: AgentToolJsonSchema): AgentToolJsonSchema {
  return {anyOf: [schema, {type: 'null'}]};
}

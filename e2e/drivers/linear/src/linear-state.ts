import type {LinearRecording} from './linear-recordings.js';
import {
  jsonResult,
  type LinearToolResult,
  missingArgument,
  notFound,
  unsupportedArguments,
} from './linear-results.js';

type Json = Record<string, unknown>;

/** The number of the first issue, project, and milestone the state creates, as in `SAW-101`. */
const FIRST_CREATED_NUMBER = 101;

const PRIORITIES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

const ISSUE_STATUSES = [
  {name: 'Backlog', type: 'backlog'},
  {name: 'Todo', type: 'unstarted'},
  {name: 'In Progress', type: 'started'},
  {name: 'Done', type: 'completed'},
  {name: 'Canceled', type: 'canceled'},
  {name: 'Duplicate', type: 'canceled'},
];

const PROJECT_STATUSES = [
  {name: 'Backlog', type: 'backlog'},
  {name: 'Planned', type: 'planned'},
  {name: 'In Progress', type: 'started'},
  {name: 'Paused', type: 'paused'},
  {name: 'Completed', type: 'completed'},
  {name: 'Canceled', type: 'canceled'},
];

/** Reads that answer from the state when it holds the object they name. */
export const LINEAR_STATE_READ_TOOLS = [
  'get_issue',
  'list_comments',
  'get_document',
  'get_project',
  'get_milestone',
  'get_status_updates',
  'list_issue_labels',
] as const;

export interface LinearState {
  /** The write tools the state serves: the ones with a recording. */
  writeTools: ReadonlySet<string>;
  /** Applies a write to the state and answers it. */
  write(tool: string, arguments_: Json): LinearToolResult;
  /** Answers a read from the state, or returns nothing when the state doesn't hold its object. */
  read(tool: string, arguments_: Json): LinearToolResult | undefined;
}

interface Team {
  id: string;
  name: string;
  key: string;
}

interface Status {
  name: string;
  type: string;
}

/**
 * The Linear objects that writes create and change, so reads after a write return the change. Each
 * write tool answers with the object its recording holds, which gives the fields and their order,
 * and the state fills in what the call changed. Objects of the sandbox workspace stay with the
 * recordings: the state holds only what a call created.
 *
 * It leaves out what no case reads: `stateHistory` on issues, pages on lists, and the arguments
 * that name other objects, such as an assignee or a parent. A call with an argument the state
 * cannot apply fails, so no read answers as if the write had applied it.
 */
export function createLinearState(params: {
  recordings: readonly LinearRecording[];
  uploadsUrl: () => URL;
}): LinearState {
  const templates = new Map<string, Json>(
    params.recordings.map((recording) => [recording.tool, recordedObject(recording)]),
  );
  const issues = new Map<string, Json>();
  const comments = new Map<string, Json[]>();
  const documents = new Map<string, Json>();
  const projects = new Map<string, Json>();
  const milestones = new Map<string, Json[]>();
  const statusUpdates = new Map<string, Json[]>();
  const labels: Json[] = [];
  const preparedUploads = new Map<string, string>();
  const counters = {
    uuid: 0,
    issue: FIRST_CREATED_NUMBER,
    project: FIRST_CREATED_NUMBER,
    milestone: 0,
  };

  const issueTemplate = templates.get('save_issue') ?? {};
  const team: Team = {
    id: String(issueTemplate.teamId ?? ''),
    name: String(issueTemplate.team ?? ''),
    key: String(issueTemplate.id ?? '').split('-')[0] ?? '',
  };
  const workspaceUrl = String(issueTemplate.url ?? '')
    .split('/')
    .slice(0, 4)
    .join('/');
  const branchPrefix = String(issueTemplate.gitBranchName ?? '').split('/')[0];

  function nextUuid(): string {
    counters.uuid += 1;
    return `00000000-0000-4000-8000-${counters.uuid.toString(16).padStart(12, '0')}`;
  }

  function slugId(uuid: string): string {
    return uuid.replaceAll('-', '').slice(-12);
  }

  function template(tool: string): Json {
    return templates.get(tool) ?? {};
  }

  function findIssue(value: unknown): Json | undefined {
    return typeof value === 'string'
      ? [...issues.values()].find((issue) => issue.id === value || issue.uuid === value)
      : undefined;
  }

  function findProject(value: unknown): Json | undefined {
    return typeof value === 'string'
      ? [...projects.values()].find(
          (project) => project.id === value || project.uuid === value || project.name === value,
        )
      : undefined;
  }

  function findTeam(value: unknown): Team | undefined {
    return [team.id, team.name, team.key].includes(String(value)) ? team : undefined;
  }

  function touch(object: Json): void {
    object.updatedAt = new Date().toISOString();
  }

  function saveIssue(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'save_issue',
      arguments_,
      allowed: ['id', 'team', 'title', 'description', 'state', 'priority', 'dueDate', 'labels'],
      createOnly: ['team'],
    });
    if (refused !== undefined) return refused;
    const status =
      arguments_.state === undefined ? undefined : findStatus(ISSUE_STATUSES, arguments_.state);
    if (arguments_.state !== undefined && status === undefined) return notFound('State');
    if (arguments_.id === undefined) return createIssue(arguments_, status);
    const issue = findIssue(arguments_.id);
    return issue === undefined
      ? notFound('Issue')
      : jsonResult(updateIssue(issue, arguments_, status));
  }

  function createIssue(arguments_: Json, status: Status | undefined): LinearToolResult {
    if (typeof arguments_.title !== 'string') return missingArgument('save_issue', 'title');
    const issueTeam = findTeam(arguments_.team);
    if (issueTeam === undefined) return notFound('Team');
    const now = new Date().toISOString();
    const number = counters.issue++;
    const identifier = `${issueTeam.key}-${number}`;
    const issue: Json = {
      ...template('save_issue'),
      id: identifier,
      uuid: nextUuid(),
      title: arguments_.title,
      description: arguments_.description ?? null,
      priority: priorityOf(arguments_.priority ?? 0),
      url: `${workspaceUrl}/issue/${identifier}/${slug(arguments_.title)}`,
      gitBranchName: `${branchPrefix}/${issueTeam.key.toLowerCase()}-${number}-${slug(arguments_.title)}`,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      startedAt: null,
      dueDate: arguments_.dueDate ?? null,
      labels: arguments_.labels ?? [],
      attachments: [],
      documents: [],
      team: issueTeam.name,
      teamId: issueTeam.id,
    };
    applyIssueStatus(issue, status ?? (ISSUE_STATUSES[0] as Status), now);
    issues.set(String(issue.uuid), issue);
    return jsonResult(issue);
  }

  function updateIssue(issue: Json, arguments_: Json, status: Status | undefined): Json {
    if (typeof arguments_.title === 'string') {
      issue.title = arguments_.title;
      issue.url = `${workspaceUrl}/issue/${String(issue.id)}/${slug(arguments_.title)}`;
    }
    copyFields(issue, arguments_, ['description', 'dueDate', 'labels']);
    if (arguments_.priority !== undefined) issue.priority = priorityOf(arguments_.priority);
    touch(issue);
    if (status !== undefined) applyIssueStatus(issue, status, String(issue.updatedAt));
    return issue;
  }

  function saveComment(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'save_comment',
      arguments_,
      allowed: ['id', 'issueId', 'body'],
    });
    if (refused !== undefined) return refused;
    const issue = findIssue(arguments_.issueId);
    if (issue === undefined) return notFound('Issue');
    if (typeof arguments_.body !== 'string') return missingArgument('save_comment', 'body');
    const issueComments = comments.get(String(issue.uuid)) ?? [];
    comments.set(String(issue.uuid), issueComments);
    if (arguments_.id !== undefined) {
      const comment = issueComments.find((item) => item.id === arguments_.id);
      if (comment === undefined) return notFound('Comment');
      comment.body = arguments_.body;
      touch(comment);
      return jsonResult(comment);
    }
    const now = new Date().toISOString();
    const comment: Json = {
      ...template('save_comment'),
      id: nextUuid(),
      body: arguments_.body,
      createdAt: now,
      updatedAt: now,
    };
    issueComments.push(comment);
    return jsonResult(comment);
  }

  function deleteComment(arguments_: Json): LinearToolResult {
    for (const issueComments of comments.values()) {
      const index = issueComments.findIndex((comment) => comment.id === arguments_.id);
      if (index >= 0) {
        issueComments.splice(index, 1);
        return jsonResult(template('delete_comment'));
      }
    }
    return notFound('Comment');
  }

  function addAttachment(params: {
    tool: string;
    arguments_: Json;
    allowed: string[];
    url: (id: string) => string | undefined;
  }): LinearToolResult {
    const refused = rejectArguments(params);
    if (refused !== undefined) return refused;
    const issue = findIssue(params.arguments_.issue);
    if (issue === undefined) return notFound('Issue');
    if (typeof params.arguments_.title !== 'string') return missingArgument(params.tool, 'title');
    const id = nextUuid();
    const url = params.url(id);
    if (url === undefined) return notFound('Upload');
    (issue.attachments as Json[]).push({id, title: params.arguments_.title, subtitle: null, url});
    touch(issue);
    return jsonResult({...template(params.tool), id, title: params.arguments_.title, url});
  }

  function createAttachment(arguments_: Json): LinearToolResult {
    return addAttachment({
      tool: 'create_attachment',
      arguments_,
      allowed: ['issue', 'title', 'filename', 'contentType', 'base64Content', 'sha256'],
      url: (id) =>
        new URL(`e2e-org/${id}/${String(arguments_.filename)}`, params.uploadsUrl()).href,
    });
  }

  function prepareAttachmentUpload(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'prepare_attachment_upload',
      arguments_,
      allowed: ['issue', 'title', 'filename', 'contentType', 'size'],
    });
    if (refused !== undefined) return refused;
    const issue = findIssue(arguments_.issue);
    if (issue === undefined) return notFound('Issue');
    const recorded = template('prepare_attachment_upload');
    const assetUrl = new URL(
      `e2e-org/${nextUuid()}/${String(arguments_.filename)}`,
      params.uploadsUrl(),
    ).href;
    preparedUploads.set(assetUrl, String(issue.uuid));
    const request = (recorded.uploadRequest ?? {}) as Json;
    const headers = {
      ...((request.headers ?? {}) as Json),
      'content-type': arguments_.contentType,
      'x-goog-content-length-range': `${String(arguments_.size)},${String(arguments_.size)}`,
      'Content-Disposition': `attachment; filename="${String(arguments_.filename)}"`,
    };
    return jsonResult({
      ...recorded,
      issueId: issue.uuid,
      assetUrl,
      uploadRequest: {...request, url: assetUrl, headers},
      finalize: {
        ...((recorded.finalize ?? {}) as Json),
        input: {issue: arguments_.issue, assetUrl, title: arguments_.title},
      },
    });
  }

  function createAttachmentFromUpload(arguments_: Json): LinearToolResult {
    return addAttachment({
      tool: 'create_attachment_from_upload',
      arguments_,
      allowed: ['issue', 'assetUrl', 'title'],
      url: () => {
        const assetUrl = String(arguments_.assetUrl);
        const issue = findIssue(arguments_.issue);
        return issue !== undefined && preparedUploads.get(assetUrl) === issue.uuid
          ? assetUrl
          : undefined;
      },
    });
  }

  function deleteAttachment(arguments_: Json): LinearToolResult {
    for (const issue of issues.values()) {
      const attachments = issue.attachments as Json[];
      const index = attachments.findIndex((attachment) => attachment.id === arguments_.id);
      if (index >= 0) {
        attachments.splice(index, 1);
        touch(issue);
        return jsonResult({...template('delete_attachment'), id: arguments_.id});
      }
    }
    return notFound('Attachment');
  }

  function createIssueLabel(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'create_issue_label',
      arguments_,
      allowed: ['name', 'color', 'description'],
    });
    if (refused !== undefined) return refused;
    if (typeof arguments_.name !== 'string') return missingArgument('create_issue_label', 'name');
    const recorded = template('create_issue_label');
    const label = {
      ...recorded,
      id: nextUuid(),
      name: arguments_.name,
      color: arguments_.color ?? recorded.color,
      description: arguments_.description ?? null,
    };
    labels.push({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description,
      archivedAt: null,
    });
    return jsonResult(label);
  }

  function saveDocument(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'save_document',
      arguments_,
      allowed: ['id', 'team', 'title', 'content'],
      createOnly: ['team'],
    });
    if (refused !== undefined) return refused;
    if (arguments_.id === undefined) return createDocument(arguments_);
    const document = documents.get(String(arguments_.id));
    if (document === undefined) return notFound('Document');
    if (typeof arguments_.title === 'string') {
      document.title = arguments_.title;
      document.url = documentUrl(arguments_.title, String(document.slugId));
    }
    copyFields(document, arguments_, ['content']);
    touch(document);
    return jsonResult(document);
  }

  function createDocument(arguments_: Json): LinearToolResult {
    const documentTeam = findTeam(arguments_.team);
    if (documentTeam === undefined) return notFound('Team');
    if (typeof arguments_.title !== 'string') return missingArgument('save_document', 'title');
    const now = new Date().toISOString();
    const id = nextUuid();
    const document: Json = {
      ...template('save_document'),
      id,
      title: arguments_.title,
      content: arguments_.content ?? null,
      url: documentUrl(arguments_.title, slugId(id)),
      slugId: slugId(id),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      team: {id: documentTeam.id, name: documentTeam.name},
    };
    documents.set(id, document);
    return jsonResult(document);
  }

  function documentUrl(title: string, id: string): string {
    return `${workspaceUrl}/document/${slug(title)}-${id}`;
  }

  function saveProject(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'save_project',
      arguments_,
      allowed: ['id', 'name', 'addTeams', 'summary', 'description', 'state'],
      createOnly: ['addTeams'],
    });
    if (refused !== undefined) return refused;
    const status =
      arguments_.state === undefined ? undefined : findStatus(PROJECT_STATUSES, arguments_.state);
    if (arguments_.state !== undefined && status === undefined) return notFound('State');
    if (arguments_.id === undefined) return createProject(arguments_, status);
    const project = findProject(arguments_.id);
    if (project === undefined) return notFound('Project');
    if (typeof arguments_.name === 'string') {
      project.name = arguments_.name;
      project.url = projectUrl(arguments_.name, String(project.uuid));
    }
    copyFields(project, arguments_, ['summary', 'description']);
    touch(project);
    if (status !== undefined) applyProjectStatus(project, status, String(project.updatedAt));
    return jsonResult(project);
  }

  function createProject(arguments_: Json, status: Status | undefined): LinearToolResult {
    if (typeof arguments_.name !== 'string') return missingArgument('save_project', 'name');
    const teams = Array.isArray(arguments_.addTeams) ? arguments_.addTeams.map(findTeam) : [];
    if (teams.length === 0 || teams.includes(undefined)) return notFound('Team');
    const now = new Date().toISOString();
    const uuid = nextUuid();
    const projectTeams = teams.map((item) => ({id: item?.id, name: item?.name, key: item?.key}));
    const project: Json = {
      ...template('save_project'),
      id: `P-${team.key}-${counters.project++}`,
      uuid,
      name: arguments_.name,
      summary: arguments_.summary ?? null,
      description: arguments_.description ?? null,
      url: projectUrl(arguments_.name, uuid),
      resourceCount: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      leadTeam: projectTeams[0],
      teams: projectTeams,
    };
    applyProjectStatus(project, status ?? (PROJECT_STATUSES[0] as Status), now);
    projects.set(uuid, project);
    return jsonResult(project);
  }

  function projectUrl(name: string, uuid: string): string {
    return `${workspaceUrl}/project/${slug(name)}-${slugId(uuid)}`;
  }

  function saveMilestone(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'save_milestone',
      arguments_,
      allowed: ['project', 'id', 'name', 'description'],
    });
    if (refused !== undefined) return refused;
    const project = findProject(arguments_.project);
    if (project === undefined) return notFound('Project');
    const projectMilestones = milestones.get(String(project.uuid)) ?? [];
    milestones.set(String(project.uuid), projectMilestones);
    if (arguments_.id === undefined) return createMilestone(arguments_, projectMilestones);
    const milestone = projectMilestones.find((item) => item.id === arguments_.id);
    if (milestone === undefined) return notFound('Milestone');
    copyFields(milestone, arguments_, ['name', 'description']);
    return jsonResult(milestone);
  }

  function createMilestone(arguments_: Json, projectMilestones: Json[]): LinearToolResult {
    if (typeof arguments_.name !== 'string') return missingArgument('save_milestone', 'name');
    counters.milestone += 1;
    const milestone: Json = {
      ...template('save_milestone'),
      id: nextUuid(),
      name: arguments_.name,
      description: arguments_.description ?? null,
      progress: 0,
      sortOrder: -counters.milestone,
    };
    projectMilestones.push(milestone);
    return jsonResult(milestone);
  }

  function saveStatusUpdate(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'save_status_update',
      arguments_,
      allowed: ['type', 'project', 'id', 'body', 'health'],
    });
    if (refused !== undefined) return refused;
    // Only project updates are applied; an initiative update would answer from the wrong state.
    if (arguments_.type !== 'project') return unsupportedArguments('save_status_update', ['type']);
    // An update names its project only when it creates the update.
    if (arguments_.id !== undefined) return changeStatusUpdate(arguments_);
    const project = findProject(arguments_.project);
    if (project === undefined) return notFound('Project');
    const updates = statusUpdates.get(String(project.uuid)) ?? [];
    statusUpdates.set(String(project.uuid), updates);
    return createStatusUpdate(arguments_, project, updates);
  }

  function changeStatusUpdate(arguments_: Json): LinearToolResult {
    const update = [...statusUpdates.values()].flat().find((item) => item.id === arguments_.id);
    if (update === undefined) return notFound('Status update');
    copyFields(update, arguments_, ['body', 'health']);
    touch(update);
    update.editedAt = update.updatedAt;
    return jsonResult(update);
  }

  function createStatusUpdate(arguments_: Json, project: Json, updates: Json[]): LinearToolResult {
    if (typeof arguments_.body !== 'string') return missingArgument('save_status_update', 'body');
    const recorded = template('save_status_update');
    const now = new Date().toISOString();
    const id = nextUuid();
    const update: Json = {
      ...recorded,
      id,
      body: arguments_.body,
      health: arguments_.health ?? recorded.health,
      url: `${String(project.url)}/activity#project-update-${id.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
      editedAt: null,
      archivedAt: null,
      diffMarkdown: `**Status**: ${String((project.status as Json).name)}`,
      project: {id: project.uuid, name: project.name},
    };
    updates.push(update);
    return jsonResult(update);
  }

  function deleteStatusUpdate(arguments_: Json): LinearToolResult {
    const refused = rejectArguments({
      tool: 'delete_status_update',
      arguments_,
      allowed: ['type', 'id'],
    });
    if (refused !== undefined) return refused;
    if (arguments_.type !== 'project')
      return unsupportedArguments('delete_status_update', ['type']);
    for (const updates of statusUpdates.values()) {
      const index = updates.findIndex((update) => update.id === arguments_.id);
      if (index >= 0) {
        updates.splice(index, 1);
        return jsonResult({...template('delete_status_update'), id: arguments_.id});
      }
    }
    return notFound('Status update');
  }

  const writers: Record<string, (arguments_: Json) => LinearToolResult> = {
    save_issue: saveIssue,
    save_comment: saveComment,
    delete_comment: deleteComment,
    create_attachment: createAttachment,
    prepare_attachment_upload: prepareAttachmentUpload,
    create_attachment_from_upload: createAttachmentFromUpload,
    delete_attachment: deleteAttachment,
    create_issue_label: createIssueLabel,
    save_document: saveDocument,
    save_project: saveProject,
    save_milestone: saveMilestone,
    save_status_update: saveStatusUpdate,
    delete_status_update: deleteStatusUpdate,
  };

  const readers: Record<string, (arguments_: Json) => LinearToolResult | undefined> = {
    get_issue: ({id}) => {
      const issue = findIssue(id);
      return issue === undefined ? undefined : jsonResult(issue);
    },
    list_comments: ({issueId}) => {
      const issue = findIssue(issueId);
      return issue === undefined
        ? undefined
        : jsonResult({comments: comments.get(String(issue.uuid)) ?? [], hasNextPage: false});
    },
    get_document: ({id}) => {
      const document = documents.get(String(id));
      return document === undefined ? undefined : jsonResult(document);
    },
    get_project: ({query}) => {
      const project = findProject(query);
      return project === undefined ? undefined : jsonResult(project);
    },
    get_milestone: ({project: projectValue, query}) => {
      const project = findProject(projectValue);
      if (project === undefined) return undefined;
      const milestone = (milestones.get(String(project.uuid)) ?? []).find(
        (item) => item.id === query || item.name === query,
      );
      return milestone === undefined ? notFound('Milestone') : jsonResult(milestone);
    },
    get_status_updates: ({type, project: projectValue}) => {
      const project = type === 'project' ? findProject(projectValue) : undefined;
      return project === undefined
        ? undefined
        : jsonResult({
            statusUpdates: statusUpdates.get(String(project.uuid)) ?? [],
            hasNextPage: false,
          });
    },
    list_issue_labels: ({name}) => {
      const matching = labels.filter(
        (label) =>
          typeof name === 'string' && String(label.name).toLowerCase().includes(name.toLowerCase()),
      );
      return matching.length === 0 ? undefined : jsonResult({labels: matching, hasNextPage: false});
    },
  };

  return {
    writeTools: new Set(Object.keys(writers).filter((tool) => templates.has(tool))),
    write: (tool, arguments_) =>
      (writers[tool] as (arguments_: Json) => LinearToolResult)(arguments_),
    read: (tool, arguments_) => readers[tool]?.(arguments_),
  };
}

function recordedObject(recording: LinearRecording): Json {
  const block = recording.result.content[0];
  return JSON.parse(String(block?.text ?? 'null')) as Json;
}

/**
 * Fails a call with an argument the state cannot apply: one the tool's handler doesn't name, or a
 * `createOnly` one on an update, which would otherwise be dropped without a trace.
 */
function rejectArguments(params: {
  tool: string;
  arguments_: Json;
  allowed: readonly string[];
  createOnly?: readonly string[];
}): LinearToolResult | undefined {
  const unsupported = Object.keys(params.arguments_).filter((key) => !params.allowed.includes(key));
  if (params.arguments_.id !== undefined) {
    unsupported.push(
      ...(params.createOnly ?? []).filter((key) => params.arguments_[key] !== undefined),
    );
  }
  return unsupported.length > 0 ? unsupportedArguments(params.tool, unsupported) : undefined;
}

function copyFields(target: Json, source: Json, fields: readonly string[]): void {
  for (const field of fields) {
    if (source[field] !== undefined) target[field] = source[field];
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-|-$/gu, '');
}

function priorityOf(value: unknown): Json {
  const index = Number(value);
  return {value: index, name: PRIORITIES[index] ?? PRIORITIES[0]};
}

function findStatus(statuses: readonly Status[], value: unknown): Status | undefined {
  const wanted = String(value).toLowerCase();
  return statuses.find((status) => status.name.toLowerCase() === wanted || status.type === wanted);
}

function applyIssueStatus(issue: Json, status: Status, now: string): void {
  issue.status = status.name;
  issue.statusType = status.type;
  if (status.type === 'started' || status.type === 'completed') issue.startedAt ??= now;
  issue.completedAt = status.type === 'completed' ? now : null;
  issue.canceledAt = status.type === 'canceled' ? now : null;
}

function applyProjectStatus(project: Json, status: Status, now: string): void {
  const index = PROJECT_STATUSES.indexOf(status);
  const previous = (project.status ?? {}) as Json;
  project.status = {
    id:
      previous.type === status.type
        ? previous.id
        : `00000000-0000-4000-9000-${index.toString(16).padStart(12, '0')}`,
    name: status.name,
    type: status.type,
  };
  if (status.type === 'started' || status.type === 'completed') project.startedAt ??= now;
  project.completedAt = status.type === 'completed' ? now : null;
  project.canceledAt = status.type === 'canceled' ? now : null;
}

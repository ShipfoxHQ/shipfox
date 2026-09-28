import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {defineAction, ToolCallError, type Tools} from '@shipfox/actions';
import {
  type CollectionReport,
  type LinearComment,
  type LinearDocument,
  type LinearIssue,
  type LinearRef,
  listAll,
  readJson,
  relatedIssueIds,
} from './linear.ts';
import {renderExport} from './markdown.ts';

declare module '@shipfox/actions' {
  interface Aliases {
    linear: 'linear';
  }
}

type Inputs = {
  issue_id: string;
  destination: string;
  allow_partial: boolean;
  max_entities: number;
  max_file_bytes: number;
  max_duration: number;
  uploads_url: string;
};

// Linear's get_issue returns at most this many relations, attachments, or documents per list,
// without saying it cut the list. A full list is reported as a possible gap.
const LINEAR_LIST_CAP = 50;
const KNOWN_LIMITS = [
  'Issues marked as duplicates of an included issue are not listed by Linear, so they are not followed.',
  'Issue mentions inside text stay links and are not followed.',
];

interface Gap {
  kind: 'unreadable' | 'page' | 'capped' | 'download' | 'budget';
  entity?: string;
  detail: string;
}

interface Download {
  url: string;
  status: 'downloaded' | 'failed' | 'skipped';
  path?: string;
  bytes?: number;
  sha256?: string;
  media_type?: string;
  error?: string;
}

interface Entity {
  type: 'issue' | 'document';
  id: string;
}

interface Walk {
  tools: Tools;
  signal: AbortSignal;
  uploadsUrl: string;
  issues: Map<string, LinearIssue>;
  documents: Map<string, LinearDocument>;
  comments: Map<string, LinearComment[]>;
  collections: CollectionReport[];
  gaps: Gap[];
  /** Signed upload URLs by their unsigned form, which identifies the file. */
  uploads: Map<string, string>;
}

export default defineAction<Inputs>(async ({inputs, tools, log, setOutput, signal}) => {
  const walk: Walk = {
    tools,
    signal,
    uploadsUrl: inputs.uploads_url,
    issues: new Map(),
    documents: new Map(),
    comments: new Map(),
    collections: [],
    gaps: [],
    uploads: new Map(),
  };
  const retrievedAt = new Date().toISOString();
  const deadline = Date.now() + inputs.max_duration * 1000;

  // The root must be readable; everything after it can fail into a gap.
  const root = readJson<LinearIssue>(
    await tools.linear.call('get_issue', {id: inputs.issue_id, includeRelations: true}, {signal}),
  );
  const rootProject = root.projectId ? {id: root.projectId, name: root.project ?? null} : null;
  const seen = new Set([`issue:${inputs.issue_id}`, `issue:${root.id}`]);
  const queue: Entity[] = await recordIssue(root, walk);
  if (rootProject !== null) queue.push(...(await listProject(rootProject.id, walk)));

  let stopped = 'completed';
  for (let entity = queue.shift(); entity !== undefined; entity = queue.shift()) {
    const key = `${entity.type}:${entity.id}`;
    if (seen.has(key)) continue;
    if (seen.size >= inputs.max_entities) {
      stopped = 'max_entities';
      walk.gaps.push({kind: 'budget', detail: `Stopped at max_entities (${inputs.max_entities}).`});
      break;
    }
    if (Date.now() > deadline) {
      stopped = 'max_duration';
      walk.gaps.push({
        kind: 'budget',
        detail: `Stopped at max_duration (${inputs.max_duration}s).`,
      });
      break;
    }
    seen.add(key);
    queue.push(...(await readEntity(entity, walk)));
  }
  log.info(`Read ${walk.issues.size} issues and ${walk.documents.size} documents.`);

  const filesPath = join(inputs.destination, 'files');
  const downloads = await downloadUploads({walk, filesPath, maxBytes: inputs.max_file_bytes});
  const complete = walk.gaps.length === 0;
  const localPaths = new Map(
    downloads.flatMap((download) =>
      download.path === undefined
        ? []
        : [[unsigned(download.url), relative(inputs.destination, download.path)] as const],
    ),
  );
  const markdown = renderExport({
    rootId: root.id,
    rootProject,
    complete,
    issues: walk.issues,
    documents: walk.documents,
    comments: walk.comments,
    localizeLinks: (text) =>
      text.replace(uploadPattern(walk.uploadsUrl), (url) => localPaths.get(unsigned(url)) ?? url),
  });
  const coverage = {
    root: {issue: root.id, project: rootProject},
    retrieved_at: retrievedAt,
    complete,
    stopped,
    counts: {
      issues: walk.issues.size,
      documents: walk.documents.size,
      comments: [...walk.comments.values()].reduce((total, list) => total + list.length, 0),
      files: downloads.filter((download) => download.status === 'downloaded').length,
    },
    collections: walk.collections,
    downloads,
    gaps: walk.gaps,
    known_limits: KNOWN_LIMITS,
  };

  // A partial export gets a name that says so, and every file appears only once whole.
  const path = join(inputs.destination, `${root.id}${complete ? '' : '.partial'}.md`);
  const coveragePath = join(inputs.destination, 'coverage.json');
  await mkdir(inputs.destination, {recursive: true});
  await writeAtomically(path, markdown);
  await writeAtomically(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);

  const outputs = {
    path,
    coverage_path: coveragePath,
    files_path: filesPath,
    complete,
    issue_count: walk.issues.size,
    file_count: coverage.counts.files,
  };
  if (complete || inputs.allow_partial) return outputs;
  for (const [name, value] of Object.entries(outputs)) setOutput(name, value);
  const summary = walk.gaps.map((gap) => `- ${gap.entity ?? 'export'}: ${gap.detail}`).join('\n');
  throw new Error(
    `The export has ${walk.gaps.length} gaps, so it was saved as ${path}. ` +
      `Set allow_partial to accept a partial export.\n${summary}`,
  );
});

async function readEntity(entity: Entity, walk: Walk): Promise<Entity[]> {
  try {
    if (entity.type === 'document') {
      const document = readJson<LinearDocument>(
        await walk.tools.linear.call('get_document', {id: entity.id}, {signal: walk.signal}),
      );
      return await recordDocument(document, walk);
    }
    const issue = readJson<LinearIssue>(
      await walk.tools.linear.call(
        'get_issue',
        {id: entity.id, includeRelations: true},
        {signal: walk.signal},
      ),
    );
    return await recordIssue(issue, walk);
  } catch (error) {
    if (!(error instanceof ToolCallError)) throw error;
    walk.gaps.push({
      kind: 'unreadable',
      entity: `${entity.type}:${entity.id}`,
      detail: error.message,
    });
    return [];
  }
}

async function recordIssue(issue: LinearIssue, walk: Walk): Promise<Entity[]> {
  walk.issues.set(issue.id, issue);
  const key = `issue:${issue.id}`;
  collectUploads(walk, issue.description, ...(issue.attachments ?? []).map((item) => item.url));
  reportCappedLists(walk, key, {
    ...issue.relations,
    attachments: issue.attachments,
    documents: issue.documents,
  });

  await recordComments(walk, key, {issueId: issue.id});
  const subIssues = await listAll<LinearRef>({
    collection: 'list_issues',
    parent: `sub-issues of ${key}`,
    key: 'issues',
    fetchPage: (cursor) =>
      walk.tools.linear.call(
        'list_issues',
        {parentId: issue.id, includeArchived: true, ...(cursor === undefined ? {} : {cursor})},
        {signal: walk.signal},
      ),
  });
  recordCollection(walk, subIssues.report);

  return [
    ...[...relatedIssueIds(issue), ...(issue.parentId ? [issue.parentId] : [])].map(
      (id): Entity => ({type: 'issue', id}),
    ),
    ...subIssues.items.map((ref): Entity => ({type: 'issue', id: ref.id})),
    ...(issue.documents ?? []).map((ref): Entity => ({type: 'document', id: ref.id})),
  ];
}

async function recordDocument(document: LinearDocument, walk: Walk): Promise<Entity[]> {
  walk.documents.set(document.id, document);
  collectUploads(walk, document.content);
  await recordComments(walk, `document:${document.id}`, {documentId: document.id});
  return [];
}

/** Only the root issue's project is expanded: its issues and documents join the walk. */
async function listProject(projectId: string, walk: Walk): Promise<Entity[]> {
  const issues = await listAll<LinearRef>({
    collection: 'list_issues',
    parent: `project:${projectId}`,
    key: 'issues',
    fetchPage: (cursor) =>
      walk.tools.linear.call(
        'list_issues',
        {project: projectId, includeArchived: true, ...(cursor === undefined ? {} : {cursor})},
        {signal: walk.signal},
      ),
  });
  recordCollection(walk, issues.report);
  const documents = await listAll<LinearRef>({
    collection: 'list_documents',
    parent: `project:${projectId}`,
    key: 'documents',
    fetchPage: (cursor) =>
      walk.tools.linear.call(
        'list_documents',
        {projectId, includeArchived: true, ...(cursor === undefined ? {} : {cursor})},
        {signal: walk.signal},
      ),
  });
  recordCollection(walk, documents.report);
  return [
    ...issues.items.map((ref): Entity => ({type: 'issue', id: ref.id})),
    ...documents.items.map((ref): Entity => ({type: 'document', id: ref.id})),
  ];
}

async function recordComments(
  walk: Walk,
  key: string,
  parent: {issueId: string} | {documentId: string},
): Promise<void> {
  const comments = await listAll<LinearComment>({
    collection: 'list_comments',
    parent: key,
    key: 'comments',
    fetchPage: (cursor) =>
      walk.tools.linear.call(
        'list_comments',
        {...parent, ...(cursor === undefined ? {} : {cursor})},
        {signal: walk.signal},
      ),
  });
  recordCollection(walk, comments.report);
  walk.comments.set(key, comments.items);
  for (const comment of comments.items) {
    collectUploads(walk, comment.body, ...(comment.attachments ?? []).map((item) => item.url));
  }
}

function recordCollection(walk: Walk, report: CollectionReport): void {
  walk.collections.push(report);
  if (!report.exhausted) {
    walk.gaps.push({kind: 'page', entity: report.parent, detail: report.error ?? 'Not exhausted.'});
  }
}

function reportCappedLists(
  walk: Walk,
  entity: string,
  lists: Record<string, unknown[] | LinearRef | null | undefined>,
): void {
  for (const [name, list] of Object.entries(lists)) {
    if (Array.isArray(list) && list.length >= LINEAR_LIST_CAP) {
      walk.gaps.push({
        kind: 'capped',
        entity,
        detail: `${name} holds ${list.length} items, Linear's limit, so some may be missing.`,
      });
    }
  }
}

function collectUploads(walk: Walk, ...texts: (string | null | undefined)[]): void {
  for (const text of texts) {
    for (const url of text?.match(uploadPattern(walk.uploadsUrl)) ?? []) {
      walk.uploads.set(unsigned(url), url);
    }
  }
}

async function downloadUploads(params: {
  walk: Walk;
  filesPath: string;
  maxBytes: number;
}): Promise<Download[]> {
  const {walk} = params;
  const downloads: Download[] = [];
  let bytes = 0;
  const urls = [...walk.uploads.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [url, signedUrl] of urls) {
    if (bytes >= params.maxBytes) {
      downloads.push({url, status: 'skipped', error: 'max_file_bytes reached'});
      continue;
    }
    try {
      const file = await walk.tools.linear.download(
        'download_file',
        {url: signedUrl},
        {destination: `${params.filesPath}/`, signal: walk.signal},
      );
      bytes += file.bytes;
      downloads.push({
        url,
        status: 'downloaded',
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
        media_type: file.mediaType,
      });
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      downloads.push({url, status: 'failed', error: error.message});
      walk.gaps.push({kind: 'download', entity: url, detail: error.message});
    }
  }
  const skipped = downloads.filter((download) => download.status === 'skipped').length;
  if (skipped > 0) {
    walk.gaps.push({
      kind: 'budget',
      detail: `Skipped ${skipped} files at max_file_bytes (${params.maxBytes}).`,
    });
  }
  return downloads;
}

function uploadPattern(uploadsUrl: string): RegExp {
  const prefix = uploadsUrl.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`${prefix}[^\\s"'<>()\\[\\]]+`, 'gu');
}

/** Linear signs upload URLs for a few minutes; without the query, a URL names one file. */
function unsigned(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
}

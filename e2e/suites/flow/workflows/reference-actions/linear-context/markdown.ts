import {
  type LinearComment,
  type LinearDocument,
  type LinearIssue,
  type LinearRef,
  personName,
} from './linear.ts';

export interface ExportContent {
  rootId: string;
  rootProject: {id: string; name: string | null} | null;
  complete: boolean;
  issues: ReadonlyMap<string, LinearIssue>;
  documents: ReadonlyMap<string, LinearDocument>;
  /** Comments by entity key, such as `issue:ENG-1` or `document:<id>`. */
  comments: ReadonlyMap<string, LinearComment[]>;
  /** Rewrites upload URLs in a body to the downloaded files. */
  localizeLinks: (text: string) => string;
}

/** Renders a stable document: the same graph always gives the same bytes. */
export function renderExport(content: ExportContent): string {
  const issues = sortedIssues(content);
  const documents = [...content.documents.values()].sort(
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
  const status = content.complete
    ? 'Complete.'
    : 'Incomplete: some pages or files are missing. See coverage.json.';
  const project = content.rootProject;
  const lines = [
    `# Linear context for ${content.rootId}`,
    '',
    status,
    '',
    project === null
      ? 'The root issue has no project.'
      : `Root project: ${project.name ?? project.id}.`,
    '',
    '## Index',
    '',
    ...issues.map((issue) => `- [${issue.id}: ${issue.title}](#${anchor('issue', issue.id)})`),
    ...documents.map((document) => `- [${document.title}](#${anchor('document', document.id)})`),
  ];
  for (const issue of issues) lines.push('', ...renderIssue(issue, content));
  for (const document of documents) lines.push('', ...renderDocument(document, content));
  return `${lines.join('\n')}\n`;
}

function sortedIssues(content: ExportContent): LinearIssue[] {
  const root = content.issues.get(content.rootId);
  const others = [...content.issues.values()]
    .filter((issue) => issue.id !== content.rootId)
    .sort((left, right) => left.id.localeCompare(right.id, 'en', {numeric: true}));
  return root === undefined ? others : [root, ...others];
}

function renderIssue(issue: LinearIssue, content: ExportContent): string[] {
  const relations = issue.relations ?? {};
  return [
    `<a id="${anchor('issue', issue.id)}"></a>`,
    `## ${issue.id}: ${issue.title}`,
    '',
    issueFacts(issue).join(' · '),
    ...relationLine('Parent', issue.parentId ? [{id: issue.parentId}] : [], content),
    ...relationLine('Blocks', relations.blocks, content),
    ...relationLine('Blocked by', relations.blockedBy, content),
    ...relationLine('Related to', relations.relatedTo, content),
    ...relationLine('Duplicate of', [relations.duplicateOf ?? []].flat(), content),
    '',
    '### Description',
    '',
    content.localizeLinks(issue.description?.trim() || '_No description._'),
    ...renderAttachments(issue, content),
    ...renderComments(content.comments.get(`issue:${issue.id}`), content),
  ];
}

function issueFacts(issue: LinearIssue): string[] {
  const assignee = personName(issue.assignee);
  return [
    issue.status,
    assignee === undefined ? 'Unassigned' : `Assignee: ${assignee}`,
    issue.project ? `Project: ${issue.project}` : 'No project',
    issue.createdAt === undefined ? undefined : `Created ${issue.createdAt}`,
    issue.updatedAt === undefined ? undefined : `Updated ${issue.updatedAt}`,
    issue.url === undefined ? undefined : `[Source](${issue.url})`,
  ].filter((fact) => fact !== undefined);
}

function renderAttachments(issue: LinearIssue, content: ExportContent): string[] {
  const attachments = issue.attachments ?? [];
  if (attachments.length === 0) return [];
  return [
    '',
    '### Attachments',
    '',
    ...attachments.map(
      (attachment) =>
        `- [${attachment.title ?? 'Attachment'}](${content.localizeLinks(attachment.url ?? '')})`,
    ),
  ];
}

function renderDocument(document: LinearDocument, content: ExportContent): string[] {
  return [
    `<a id="${anchor('document', document.id)}"></a>`,
    `## Document: ${document.title}`,
    '',
    document.url === undefined ? `Document ${document.id}` : `[Source](${document.url})`,
    '',
    content.localizeLinks(document.content?.trim() || '_Empty document._'),
    ...renderComments(content.comments.get(`document:${document.id}`), content),
  ];
}

function renderComments(comments: LinearComment[] | undefined, content: ExportContent): string[] {
  if (comments === undefined || comments.length === 0) return [];
  const sorted = [...comments].sort(
    (left, right) =>
      (left.createdAt ?? '').localeCompare(right.createdAt ?? '') ||
      left.id.localeCompare(right.id),
  );
  const lines = ['', '### Comments'];
  for (const comment of sorted) {
    const reply = comment.parentId ? ' (reply)' : '';
    lines.push(
      '',
      `**${personName(comment.author) ?? 'Unknown'}**, ${comment.createdAt ?? 'undated'}${reply}:`,
      '',
      content.localizeLinks(comment.body?.trim() || '_Empty comment._'),
    );
  }
  return lines;
}

function relationLine(
  label: string,
  refs: LinearRef[] | undefined,
  content: ExportContent,
): string[] {
  if (refs === undefined || refs.length === 0) return [];
  const links = refs.map((ref) =>
    content.issues.has(ref.id) ? `[${ref.id}](#${anchor('issue', ref.id)})` : ref.id,
  );
  return ['', `${label}: ${links.join(', ')}`];
}

function anchor(type: 'issue' | 'document', id: string): string {
  return `${type}-${id.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`;
}

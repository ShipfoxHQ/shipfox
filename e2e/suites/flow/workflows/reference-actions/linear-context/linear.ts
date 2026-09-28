import {ToolCallError, type ToolResult} from '@shipfox/actions';

export interface LinearRef {
  id: string;
  title?: string;
}

export type LinearPerson = string | {name?: string} | null | undefined;

export interface LinearIssue {
  id: string;
  title: string;
  url?: string;
  description?: string | null;
  status?: string;
  assignee?: LinearPerson;
  createdAt?: string;
  updatedAt?: string;
  project?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  attachments?: {title?: string; url?: string}[];
  documents?: LinearRef[];
  relations?: {
    blocks?: LinearRef[];
    blockedBy?: LinearRef[];
    relatedTo?: LinearRef[];
    duplicateOf?: LinearRef | LinearRef[] | null;
  };
}

export interface LinearDocument {
  id: string;
  title: string;
  url?: string;
  content?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LinearComment {
  id: string;
  body?: string | null;
  author?: LinearPerson;
  createdAt?: string;
  parentId?: string | null;
  attachments?: {title?: string; url?: string}[];
}

export interface CollectionReport {
  collection: string;
  parent: string;
  pages: number;
  items: number;
  exhausted: boolean;
  error?: string;
}

/** The Linear tools proxy Linear's hosted MCP server, which answers with JSON as text. */
export function readJson<T>(result: ToolResult): T {
  return (result.structured ?? result.json()) as T;
}

/** Follows every cursor. A failed page ends the list early and says so in the report. */
export async function listAll<T>(params: {
  collection: string;
  parent: string;
  key: string;
  fetchPage: (cursor: string | undefined) => Promise<ToolResult>;
}): Promise<{items: T[]; report: CollectionReport}> {
  const items: T[] = [];
  let pages = 0;
  let cursor: string | undefined;
  const report = (exhausted: boolean, error?: string): CollectionReport => ({
    collection: params.collection,
    parent: params.parent,
    pages,
    items: items.length,
    exhausted,
    ...(error === undefined ? {} : {error}),
  });
  try {
    do {
      const page = readJson<Record<string, unknown>>(await params.fetchPage(cursor));
      pages += 1;
      items.push(...((page[params.key] as T[] | undefined) ?? []));
      if (page.hasNextPage === false) return {items, report: report(true)};
      if (page.hasNextPage !== true) {
        return {items, report: report(false, 'Linear did not say whether more pages exist.')};
      }
      cursor = typeof page.cursor === 'string' ? page.cursor : undefined;
    } while (cursor !== undefined);
    return {items, report: report(false, 'Linear reported more pages without a cursor.')};
  } catch (error) {
    if (!(error instanceof ToolCallError)) throw error;
    return {items, report: report(false, error.message)};
  }
}

export function personName(person: LinearPerson): string | undefined {
  if (typeof person === 'string') return person;
  return person?.name;
}

export function relatedIssueIds(issue: LinearIssue): string[] {
  const relations = issue.relations ?? {};
  const duplicateOf = relations.duplicateOf ?? [];
  return [
    ...(relations.blocks ?? []),
    ...(relations.blockedBy ?? []),
    ...(relations.relatedTo ?? []),
    ...(Array.isArray(duplicateOf) ? duplicateOf : [duplicateOf]),
  ].map((ref) => ref.id);
}

import {and, asc, eq, type SQL, sql} from 'drizzle-orm';
import {db} from './db.js';
import {managedRepositories, toManagedRepository} from './schema/repositories.js';

export const MANAGED_REPOSITORY_OWNER = 'shipfox';

/**
 * `active` accepts writes. `linking` is a move that is running or stopped with an unknown
 * outcome. `linked` is final: the project's config source moved to another repository.
 */
export type ManagedRepositoryStatus = 'active' | 'linking' | 'linked';

/** The target of a move and who started it. Kept after the move completes. */
export interface ManagedRepositoryLink {
  attemptId: string;
  connectionId: string;
  externalRepositoryId: string;
  startedBy: string | null;
  startedAt: Date | null;
}

export interface ManagedRepository {
  id: string;
  workspaceId: string;
  projectId: string;
  status: ManagedRepositoryStatus;
  link: ManagedRepositoryLink | null;
  /** Set once the move's pull request opens. Cleared once it reads as merged. */
  pullRequest: {url: string; number: number} | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getManagedRepository(params: {
  id: string;
  workspaceId: string;
}): Promise<ManagedRepository | undefined> {
  const [row] = await db()
    .select()
    .from(managedRepositories)
    .where(
      and(
        eq(managedRepositories.id, params.id),
        eq(managedRepositories.workspaceId, params.workspaceId),
      ),
    )
    .limit(1);
  return row ? toManagedRepository(row) : undefined;
}

export async function listManagedRepositories(params: {
  workspaceId: string;
  /** Matches any part of the full name, ignoring case. */
  search?: string | undefined;
  limit: number;
  offset: number;
}): Promise<ManagedRepository[]> {
  const rows = await db()
    .select()
    .from(managedRepositories)
    .where(
      and(
        eq(managedRepositories.workspaceId, params.workspaceId),
        params.search ? fullNameContains(params.search) : undefined,
      ),
    )
    .orderBy(asc(managedRepositories.id))
    .limit(params.limit)
    .offset(params.offset);
  return rows.map(toManagedRepository);
}

function fullNameContains(search: string): SQL {
  return sql`strpos(${MANAGED_REPOSITORY_OWNER}::text || '/' || ${managedRepositories.id}::text, ${search.toLowerCase()}::text) > 0`;
}

export async function getManagedRepositoryByProject(params: {
  projectId: string;
  workspaceId: string;
}): Promise<ManagedRepository | undefined> {
  const [row] = await db()
    .select()
    .from(managedRepositories)
    .where(
      and(
        eq(managedRepositories.projectId, params.projectId),
        eq(managedRepositories.workspaceId, params.workspaceId),
      ),
    )
    .limit(1);
  return row ? toManagedRepository(row) : undefined;
}

export type BeginManagedLinkResult =
  | {kind: 'started' | 'resumed'; repository: ManagedRepository}
  | {kind: 'linked'; repository: ManagedRepository};

/**
 * Starts a move, or resumes the one that is running or stopped. A resume keeps the stored attempt
 * and target and only restarts the clock, so a retry never opens a second pull request.
 */
export async function beginManagedLink(params: {
  repositoryId: string;
  attemptId: string;
  connectionId: string;
  externalRepositoryId: string;
  startedBy: string;
  now?: Date | undefined;
}): Promise<BeginManagedLinkResult | undefined> {
  const now = params.now ?? new Date();
  return await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(managedRepositories)
      .where(eq(managedRepositories.id, params.repositoryId))
      .for('update');
    if (!row) return undefined;
    if (row.status === 'linked') return {kind: 'linked', repository: toManagedRepository(row)};

    const resumed = row.status === 'linking';
    const [updated] = await tx
      .update(managedRepositories)
      .set(
        resumed
          ? {linkStartedAt: now, updatedAt: now}
          : {
              status: 'linking',
              linkAttemptId: params.attemptId,
              linkConnectionId: params.connectionId,
              linkExternalRepositoryId: params.externalRepositoryId,
              linkStartedBy: params.startedBy,
              linkStartedAt: now,
              updatedAt: now,
            },
      )
      .where(eq(managedRepositories.id, params.repositoryId))
      .returning();
    return {
      kind: resumed ? 'resumed' : 'started',
      repository: toManagedRepository(updated ?? row),
    };
  });
}

export async function recordManagedLinkPullRequest(params: {
  repositoryId: string;
  attemptId: string;
  url: string;
  number: number;
}): Promise<boolean> {
  const rows = await db()
    .update(managedRepositories)
    .set({pullRequestUrl: params.url, pullRequestNumber: params.number, updatedAt: new Date()})
    .where(
      and(
        eq(managedRepositories.id, params.repositoryId),
        eq(managedRepositories.status, 'linking'),
        eq(managedRepositories.linkAttemptId, params.attemptId),
      ),
    )
    .returning({id: managedRepositories.id});
  return rows.length > 0;
}

export async function completeManagedLink(params: {
  repositoryId: string;
  attemptId: string;
}): Promise<boolean> {
  const rows = await db()
    .update(managedRepositories)
    .set({status: 'linked', updatedAt: new Date()})
    .where(
      and(
        eq(managedRepositories.id, params.repositoryId),
        eq(managedRepositories.status, 'linking'),
        eq(managedRepositories.linkAttemptId, params.attemptId),
      ),
    )
    .returning({id: managedRepositories.id});
  return rows.length > 0;
}

/** Returns a move that was definitely refused to `active`, so writes work again. */
export async function releaseManagedLink(params: {
  repositoryId: string;
  attemptId: string;
}): Promise<boolean> {
  const rows = await db()
    .update(managedRepositories)
    .set({
      status: 'active',
      linkAttemptId: null,
      linkConnectionId: null,
      linkExternalRepositoryId: null,
      linkStartedBy: null,
      linkStartedAt: null,
      pullRequestUrl: null,
      pullRequestNumber: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(managedRepositories.id, params.repositoryId),
        eq(managedRepositories.status, 'linking'),
        eq(managedRepositories.linkAttemptId, params.attemptId),
      ),
    )
    .returning({id: managedRepositories.id});
  return rows.length > 0;
}

/** Swaps a closed pull request for a new one, with a new attempt. Answers whether it applied. */
export async function replaceManagedLinkPullRequest(params: {
  repositoryId: string;
  expectedAttemptId: string;
  attemptId: string;
  url: string;
  number: number;
}): Promise<boolean> {
  const rows = await db()
    .update(managedRepositories)
    .set({
      linkAttemptId: params.attemptId,
      pullRequestUrl: params.url,
      pullRequestNumber: params.number,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(managedRepositories.id, params.repositoryId),
        eq(managedRepositories.status, 'linked'),
        eq(managedRepositories.linkAttemptId, params.expectedAttemptId),
      ),
    )
    .returning({id: managedRepositories.id});
  return rows.length > 0;
}

/** Forgets the pull request once it merged, so the page stops reading it. */
export async function clearManagedLinkPullRequest(params: {
  repositoryId: string;
  number: number;
}): Promise<void> {
  await db()
    .update(managedRepositories)
    .set({pullRequestUrl: null, pullRequestNumber: null, updatedAt: new Date()})
    .where(
      and(
        eq(managedRepositories.id, params.repositoryId),
        eq(managedRepositories.pullRequestNumber, params.number),
      ),
    );
}

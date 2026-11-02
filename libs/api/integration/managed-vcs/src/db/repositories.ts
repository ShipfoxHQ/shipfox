import {and, asc, eq, type SQL, sql} from 'drizzle-orm';
import {db} from './db.js';
import {managedRepositories, toManagedRepository} from './schema/repositories.js';

export const MANAGED_REPOSITORY_OWNER = 'shipfox';

export interface ManagedRepository {
  id: string;
  workspaceId: string;
  projectId: string;
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

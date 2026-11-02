import {MANAGED_VCS_PROVIDER} from '@shipfox/api-integration-managed-vcs-dto';
import {buildProviderRepositoryId} from '@shipfox/api-integration-spi';
import {and, eq} from 'drizzle-orm';
import {type TreeEntry, writeBlob, writeCommit, writeTree} from 'isomorphic-git';
import {createObjectFs, MANAGED_GITDIR, type ObjectFs} from '#core/object-fs.js';
import {db} from '#db/db.js';
import {insertObjects} from '#db/objects.js';
import {managedRefs} from '#db/schema/refs.js';
import {managedRepositories} from '#db/schema/repositories.js';
import {assertSeedFiles, type ManagedSeedFile} from './seed-files.js';

const COMMITTER = {name: 'Shipfox', email: 'noreply@shipfox.io'};

export class ManagedRepositoryProjectConflictError extends Error {
  constructor(readonly projectId: string) {
    super(`Project ${projectId} already has a managed repository in another workspace`);
    this.name = 'ManagedRepositoryProjectConflictError';
  }
}

export interface CreateManagedRepositoryParams {
  workspaceId: string;
  projectId: string;
  /** The tree of the first commit. Without it, `main` points at the empty tree. */
  files?: readonly ManagedSeedFile[] | undefined;
  now?: Date | undefined;
}

export interface CreatedManagedRepository {
  repositoryId: string;
  externalRepositoryId: string;
}

/**
 * Creates the repository of a project, with `main` at a commit of the seed files. Idempotent on
 * `projectId`: a repeat call returns the repository that exists and ignores the files, because
 * `main` only moves through a merge.
 */
export async function createManagedRepository(
  params: CreateManagedRepositoryParams,
): Promise<CreatedManagedRepository> {
  const files = params.files ?? [];
  assertSeedFiles(files);

  const repositoryId = await db().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(managedRepositories)
      .values({workspaceId: params.workspaceId, projectId: params.projectId})
      .onConflictDoNothing({target: managedRepositories.projectId})
      .returning({id: managedRepositories.id});
    if (!inserted) return undefined;

    const objects = createObjectFs({repositoryId: inserted.id});
    const commitOid = await writeSeedCommit({objects, files, now: params.now ?? new Date()});
    await insertObjects({repositoryId: inserted.id, objects: objects.bufferedObjects()}, {tx});
    await tx
      .insert(managedRefs)
      .values({repositoryId: inserted.id, name: 'refs/heads/main', commitOid});
    return inserted.id;
  });

  const existing = repositoryId ?? (await findRepositoryForProject(params));
  return {
    repositoryId: existing,
    externalRepositoryId: buildProviderRepositoryId(MANAGED_VCS_PROVIDER, existing),
  };
}

async function findRepositoryForProject(params: {
  workspaceId: string;
  projectId: string;
}): Promise<string> {
  const [row] = await db()
    .select({id: managedRepositories.id, workspaceId: managedRepositories.workspaceId})
    .from(managedRepositories)
    .where(eq(managedRepositories.projectId, params.projectId))
    .limit(1);
  if (!row) throw new Error('The managed repository insert conflicted, but no row was found');
  if (row.workspaceId !== params.workspaceId) {
    throw new ManagedRepositoryProjectConflictError(params.projectId);
  }
  return row.id;
}

/** Deletes the repository of a project, with its objects and refs. Answers whether one existed. */
export async function deleteManagedRepository(params: {
  workspaceId: string;
  projectId: string;
}): Promise<boolean> {
  const rows = await db()
    .delete(managedRepositories)
    .where(
      and(
        eq(managedRepositories.projectId, params.projectId),
        eq(managedRepositories.workspaceId, params.workspaceId),
      ),
    )
    .returning({id: managedRepositories.id});
  return rows.length > 0;
}

async function writeSeedCommit(params: {
  objects: ObjectFs;
  files: readonly ManagedSeedFile[];
  now: Date;
}): Promise<string> {
  const tree = await writeFileTree(
    params.objects,
    new Map(params.files.map((file) => [file.path, file.content])),
  );
  const author = {
    ...COMMITTER,
    timestamp: Math.floor(params.now.getTime() / 1000),
    timezoneOffset: 0,
  };
  return await writeCommit({
    fs: params.objects.client,
    gitdir: MANAGED_GITDIR,
    commit: {message: 'Create the project\n', tree, parent: [], author, committer: author},
  });
}

async function writeFileTree(
  objects: ObjectFs,
  files: ReadonlyMap<string, string>,
): Promise<string> {
  const entries: TreeEntry[] = [];
  const folders = new Map<string, Map<string, string>>();

  for (const [path, content] of files) {
    const separator = path.indexOf('/');
    if (separator === -1) {
      const oid = await writeBlob({
        fs: objects.client,
        gitdir: MANAGED_GITDIR,
        blob: new TextEncoder().encode(content),
      });
      entries.push({mode: '100644', path, oid, type: 'blob'});
      continue;
    }
    const folder = path.slice(0, separator);
    const nested = folders.get(folder) ?? new Map<string, string>();
    nested.set(path.slice(separator + 1), content);
    folders.set(folder, nested);
  }

  for (const [path, nested] of folders) {
    entries.push({mode: '040000', path, oid: await writeFileTree(objects, nested), type: 'tree'});
  }

  return await writeTree({fs: objects.client, gitdir: MANAGED_GITDIR, tree: entries});
}

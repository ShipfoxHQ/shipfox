import {MANAGED_VCS_PROVIDER} from '@shipfox/api-integration-managed-vcs-dto';
import {buildProviderRepositoryId, type IntegrationConnection} from '@shipfox/api-integration-spi';
import {type TreeEntry, writeBlob, writeCommit, writeTree} from 'isomorphic-git';
import {createObjectFs, MANAGED_GITDIR, type ObjectFs} from '#core/object-fs.js';
import {db} from '#db/db.js';
import {insertObjects} from '#db/objects.js';
import {managedRefs} from '#db/schema/refs.js';
import {managedRepositories} from '#db/schema/repositories.js';

export type ManagedConnection = IntegrationConnection<typeof MANAGED_VCS_PROVIDER>;

export type SeedContent = string | Uint8Array | {symlink: string} | {submodule: string};

export interface SeedFile {
  path: string;
  content: SeedContent;
}

export interface SeedCommit {
  files?: readonly SeedFile[] | undefined;
  /** Paths to drop from the tree of the previous commit. */
  deletes?: readonly string[] | undefined;
  message?: string | undefined;
  author?: string | undefined;
  timestamp?: number | undefined;
  /** Commits to record as extra parents, after the previous commit. */
  extraParents?: readonly string[] | undefined;
}

export function managedConnection(workspaceId: string): ManagedConnection {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    provider: MANAGED_VCS_PROVIDER,
    externalAccountId: workspaceId,
    slug: 'shipfox-managed',
    displayName: 'Shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function createRepositoryRow(workspaceId: string = crypto.randomUUID()) {
  const [row] = await db()
    .insert(managedRepositories)
    .values({workspaceId, projectId: crypto.randomUUID()})
    .returning();
  if (!row) throw new Error('The repository insert returned no row');
  return {
    id: row.id,
    workspaceId,
    externalRepositoryId: buildProviderRepositoryId(MANAGED_VCS_PROVIDER, row.id),
    connection: managedConnection(workspaceId),
  };
}

/** Commits through the object adapter, one commit per entry, and moves the branch to the last. */
export async function seedCommits(params: {
  repositoryId: string;
  commits: readonly SeedCommit[];
  branch?: string | undefined;
  parent?: string | undefined;
  files?: ReadonlyMap<string, SeedContent> | undefined;
}): Promise<string[]> {
  const objects = createObjectFs({repositoryId: params.repositoryId});
  const files = new Map(params.files);
  const oids: string[] = [];
  let parent = params.parent;

  for (const [index, commit] of params.commits.entries()) {
    for (const file of commit.files ?? []) files.set(file.path, file.content);
    for (const path of commit.deletes ?? []) files.delete(path);

    const author = {
      name: commit.author ?? 'Ada',
      email: 'ada@example.com',
      timestamp: commit.timestamp ?? 1_790_000_000 + index,
      timezoneOffset: 0,
    };
    const oid = await writeCommit({
      fs: objects.client,
      gitdir: MANAGED_GITDIR,
      commit: {
        message: `${commit.message ?? `Commit ${index}`}\n`,
        tree: await writeFileTree(objects, files),
        parent: [...(parent ? [parent] : []), ...(commit.extraParents ?? [])],
        author,
        committer: author,
      },
    });
    oids.push(oid);
    parent = oid;
  }

  const head = oids.at(-1);
  if (head === undefined) throw new Error('A seed needs at least one commit');
  await db().transaction(async (tx) => {
    await insertObjects(
      {repositoryId: params.repositoryId, objects: objects.bufferedObjects()},
      {tx},
    );
    await tx
      .insert(managedRefs)
      .values({
        repositoryId: params.repositoryId,
        name: `refs/heads/${params.branch ?? 'main'}`,
        commitOid: head,
      })
      .onConflictDoUpdate({
        target: [managedRefs.repositoryId, managedRefs.name],
        set: {commitOid: head},
      });
  });
  return oids;
}

async function writeFileTree(
  objects: ObjectFs,
  files: ReadonlyMap<string, SeedContent>,
): Promise<string> {
  const entries: TreeEntry[] = [];
  const folders = new Map<string, Map<string, SeedContent>>();

  for (const [path, content] of files) {
    const separator = path.indexOf('/');
    if (separator === -1) {
      entries.push(await writeFileEntry(objects, path, content));
      continue;
    }
    const folder = path.slice(0, separator);
    const nested = folders.get(folder) ?? new Map<string, SeedContent>();
    nested.set(path.slice(separator + 1), content);
    folders.set(folder, nested);
  }

  for (const [path, nested] of folders) {
    const oid = await writeFileTree(objects, nested);
    entries.push({mode: '040000', path, oid, type: 'tree'});
  }

  return await writeTree({fs: objects.client, gitdir: MANAGED_GITDIR, tree: entries});
}

async function writeFileEntry(
  objects: ObjectFs,
  path: string,
  content: SeedContent,
): Promise<TreeEntry> {
  if (typeof content === 'object' && 'submodule' in content) {
    return {mode: '160000', path, oid: content.submodule, type: 'commit'};
  }
  const isSymlink = typeof content === 'object' && 'symlink' in content;
  const bytes = isSymlink ? content.symlink : content;
  const blob = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const oid = await writeBlob({fs: objects.client, gitdir: MANAGED_GITDIR, blob});
  return {mode: isSymlink ? '120000' : '100644', path, oid, type: 'blob'};
}

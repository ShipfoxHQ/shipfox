import {Buffer} from 'node:buffer';
import {MANAGED_DEFAULT_BRANCH} from '@shipfox/api-integration-managed-vcs-dto';
import {
  decodeRepositoryFileText,
  IntegrationProviderError,
  isValidGitObjectId,
  isValidResolvableRef,
  MAX_REPOSITORY_FILE_BYTES,
} from '@shipfox/api-integration-spi';
import {and, eq} from 'drizzle-orm';
import {type TreeEntry, writeBlob, writeCommit, writeTree} from 'isomorphic-git';
import {db, type ManagedTx} from '#db/db.js';
import {insertObjects} from '#db/objects.js';
import {getRefCommitOid} from '#db/refs.js';
import {getManagedRepository} from '#db/repositories.js';
import {managedRefs} from '#db/schema/refs.js';
import {managedRepositories} from '#db/schema/repositories.js';
import {GitReader} from './git-reader.js';
import {createObjectFs, MANAGED_GITDIR, type ObjectFs} from './object-fs.js';
import {
  findFileDirectoryConflict,
  isAllowedPath,
  MAX_SEED_BYTES,
  MAX_SEED_FILES,
} from './seed-files.js';

// A commit and a seed share their limits, which keep both under the MCP body limit.
export const MAX_COMMIT_FILES = MAX_SEED_FILES;
export const MAX_COMMIT_BYTES = MAX_SEED_BYTES;

const COMMITTER = {name: 'Shipfox', email: 'noreply@shipfox.io'};
const BRANCH_PREFIX = 'refs/heads/';
const MAIN_REF = `${BRANCH_PREFIX}${MANAGED_DEFAULT_BRANCH}`;
const FILE_MODE = '100644';
const TREE_MODE = '040000';

export interface ManagedFileChange {
  path: string;
  /** The new content of the file. `null` deletes it. */
  content: string | null;
}

export interface CommitManagedChangesParams {
  workspaceId: string;
  repositoryId: string;
  /** A branch name, or its full `refs/heads/` ref. */
  branch: string;
  /** The head the caller read. Omit it to create the branch, which starts from `main`. */
  expectedHead?: string | undefined;
  message: string;
  changes: readonly ManagedFileChange[];
  author: {name: string; email: string};
  now?: Date | undefined;
}

export interface CommittedManagedChanges {
  branch: string;
  commit: string;
  /** The head the commit was built on. */
  parent: string;
}

export type ManagedCommitRefusal =
  | 'protected-branch'
  | 'branch-invalid'
  | 'stale-head'
  | 'path-not-allowed'
  | 'content-not-text'
  | 'file-too-large'
  | 'file-not-found'
  | 'too-many-changes'
  | 'commit-too-large'
  | 'no-changes';

/**
 * A commit the repository refuses. `path` names the offending change, and `head` is the current
 * head of the branch for `stale-head`, which is `null` when the branch does not exist.
 */
export class ManagedCommitRefusedError extends Error {
  constructor(
    readonly refusal: ManagedCommitRefusal,
    readonly details: {branch?: string; path?: string; head?: string | null} = {},
  ) {
    super(
      details.path === undefined
        ? `The commit was refused: ${refusal}`
        : `The commit was refused: ${refusal} (${details.path})`,
    );
    this.name = 'ManagedCommitRefusedError';
  }
}

interface PendingChange {
  path: string;
  segments: readonly string[];
  content: string | null;
}

/**
 * Commits several file changes to one branch and moves the branch with a compare-and-set. The
 * objects and the ref commit in one transaction, so a refused or lost race leaves nothing behind.
 * `main` never moves here: only project creation and a merge write it.
 */
export async function commitManagedChanges(
  params: CommitManagedChangesParams,
): Promise<CommittedManagedChanges> {
  const branch = normalizeBranch(params.branch);
  const refName = `${BRANCH_PREFIX}${branch}`;
  const changes = validateChanges(params.changes);

  const repository = await getManagedRepository({
    id: params.repositoryId,
    workspaceId: params.workspaceId,
  });
  if (!repository) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `Managed repository ${params.repositoryId} was not found`,
    );
  }

  const parent = await resolveParent({
    repositoryId: repository.id,
    branch,
    refName,
    expectedHead: params.expectedHead,
  });

  const objects = createObjectFs({repositoryId: repository.id});
  const reader = new GitReader(repository.id);
  const base = await reader.readCommit(parent);
  const tree = await buildTree({objects, reader, baseTree: base.tree, changes});
  if (tree === base.tree) throw new ManagedCommitRefusedError('no-changes', {branch});

  const timestamp = Math.floor((params.now ?? new Date()).getTime() / 1000);
  const commit = await writeCommit({
    fs: objects.client,
    gitdir: MANAGED_GITDIR,
    commit: {
      message: params.message.endsWith('\n') ? params.message : `${params.message}\n`,
      tree,
      parent: [parent],
      author: {...params.author, timestamp, timezoneOffset: 0},
      committer: {...COMMITTER, timestamp, timezoneOffset: 0},
    },
  });

  try {
    await db().transaction(async (tx) => {
      // Shared, so writes run side by side and only a statement that needs the row exclusively waits.
      const [locked] = await tx
        .select({id: managedRepositories.id})
        .from(managedRepositories)
        .where(eq(managedRepositories.id, repository.id))
        .for('share');
      if (!locked) {
        throw new IntegrationProviderError(
          'repository-not-found',
          `Managed repository ${repository.id} was deleted during the commit`,
        );
      }

      await insertObjects({repositoryId: repository.id, objects: objects.bufferedObjects()}, {tx});
      const moved = await moveRef({
        tx,
        repositoryId: repository.id,
        refName,
        commit,
        expectedHead: params.expectedHead,
        now: params.now ?? new Date(),
      });
      // Throwing rolls the objects back, so a lost race leaves nothing behind.
      if (!moved) throw new LostRaceError();
    });
  } catch (error) {
    if (!(error instanceof LostRaceError)) throw error;
    const head = (await getRefCommitOid({repositoryId: repository.id, name: refName})) ?? null;
    throw new ManagedCommitRefusedError('stale-head', {branch, head});
  }
  return {branch, commit, parent};
}

class LostRaceError extends Error {}

async function moveRef(params: {
  tx: ManagedTx;
  repositoryId: string;
  refName: string;
  commit: string;
  expectedHead: string | undefined;
  now: Date;
}): Promise<boolean> {
  const {tx, repositoryId, refName, commit, expectedHead, now} = params;
  if (expectedHead === undefined) {
    const inserted = await tx
      .insert(managedRefs)
      .values({repositoryId, name: refName, commitOid: commit})
      .onConflictDoNothing()
      .returning({name: managedRefs.name});
    return inserted.length > 0;
  }
  const updated = await tx
    .update(managedRefs)
    .set({commitOid: commit, updatedAt: now})
    .where(
      and(
        eq(managedRefs.repositoryId, repositoryId),
        eq(managedRefs.name, refName),
        eq(managedRefs.commitOid, expectedHead),
      ),
    )
    .returning({name: managedRefs.name});
  return updated.length > 0;
}

function normalizeBranch(input: string): string {
  const branch = input.startsWith(BRANCH_PREFIX) ? input.slice(BRANCH_PREFIX.length) : input;
  const refName = `${BRANCH_PREFIX}${branch}`;
  if (refName === MAIN_REF) {
    throw new ManagedCommitRefusedError('protected-branch', {branch});
  }
  // A commit id is not a branch name, and neither is a ref of another kind, such as a pull request.
  if (isValidGitObjectId(branch) || branch.startsWith('refs/') || !isValidResolvableRef(refName)) {
    throw new ManagedCommitRefusedError('branch-invalid', {branch});
  }
  return branch;
}

function validateChanges(input: readonly ManagedFileChange[]): PendingChange[] {
  if (input.length === 0) throw new ManagedCommitRefusedError('no-changes');
  if (input.length > MAX_COMMIT_FILES) throw new ManagedCommitRefusedError('too-many-changes');

  const paths = new Set<string>();
  const written = new Set<string>();
  let total = 0;
  for (const change of input) {
    if (!isAllowedPath(change.path) || paths.has(change.path)) {
      throw new ManagedCommitRefusedError('path-not-allowed', {path: change.path});
    }
    paths.add(change.path);
    if (change.content === null) continue;

    written.add(change.path);
    const bytes = Buffer.from(change.content, 'utf8');
    if (bytes.byteLength > MAX_REPOSITORY_FILE_BYTES) {
      throw new ManagedCommitRefusedError('file-too-large', {path: change.path});
    }
    if (!isText({content: change.content, bytes})) {
      throw new ManagedCommitRefusedError('content-not-text', {path: change.path});
    }
    total += bytes.byteLength;
  }
  if (total > MAX_COMMIT_BYTES) throw new ManagedCommitRefusedError('commit-too-large');

  const conflict = findFileDirectoryConflict(paths);
  if (conflict !== undefined) {
    throw new ManagedCommitRefusedError('path-not-allowed', {path: conflict});
  }
  return input.map((change) => ({
    path: change.path,
    segments: change.path.split('/'),
    content: change.content,
  }));
}

// A NUL byte marks a binary file. A lone surrogate does not survive the trip through UTF-8.
function isText(params: {content: string; bytes: Buffer}): boolean {
  if (params.content.includes('\u0000')) return false;
  return decodeRepositoryFileText(params.bytes) === params.content;
}

/** A new branch starts from `main`. An existing one must still point where the caller last saw it. */
async function resolveParent(params: {
  repositoryId: string;
  branch: string;
  refName: string;
  expectedHead: string | undefined;
}): Promise<string> {
  const {repositoryId, branch, refName, expectedHead} = params;
  const head = await getRefCommitOid({repositoryId, name: refName});

  if (expectedHead === undefined) {
    if (head !== undefined) throw new ManagedCommitRefusedError('stale-head', {branch, head});
    const main = await getRefCommitOid({repositoryId, name: MAIN_REF});
    if (!main) {
      throw new IntegrationProviderError(
        'ref-not-found',
        `Managed repository ${repositoryId} has no ${MANAGED_DEFAULT_BRANCH} branch`,
      );
    }
    return main;
  }
  if (head !== expectedHead) {
    throw new ManagedCommitRefusedError('stale-head', {branch, head: head ?? null});
  }
  return head;
}

async function buildTree(params: {
  objects: ObjectFs;
  reader: GitReader;
  baseTree: string;
  changes: readonly PendingChange[];
}): Promise<string> {
  const tree = await applyToTree({...params, treeOid: params.baseTree, depth: 0});
  return tree ?? (await writeTree({fs: params.objects.client, gitdir: MANAGED_GITDIR, tree: []}));
}

/** Answers the new tree, or null when it ends up with no entries, because git stores no empty folder. */
async function applyToTree(params: {
  objects: ObjectFs;
  reader: GitReader;
  treeOid: string | null;
  changes: readonly PendingChange[];
  depth: number;
}): Promise<string | null> {
  const {objects, reader, treeOid, changes, depth} = params;
  const existing = treeOid === null ? [] : await reader.readTree(treeOid);
  const entries = new Map<string, TreeEntry>(existing.map((entry) => [entry.path, entry]));

  for (const [name, group] of groupBySegment(changes, depth)) {
    const current = entries.get(name);
    const leaf = group.find((change) => change.segments.length === depth + 1);
    if (leaf !== undefined) {
      if (group.length > 1) {
        throw new ManagedCommitRefusedError('path-not-allowed', {path: leaf.path});
      }
      await applyLeaf({objects, entries, name, current, change: leaf});
      continue;
    }

    assertFolder({current, group});
    const child = await applyToTree({
      objects,
      reader,
      treeOid: current?.oid ?? null,
      changes: group,
      depth: depth + 1,
    });
    if (child === null) entries.delete(name);
    else entries.set(name, {mode: TREE_MODE, path: name, oid: child, type: 'tree'});
  }

  if (entries.size === 0) return null;
  return await writeTree({fs: objects.client, gitdir: MANAGED_GITDIR, tree: [...entries.values()]});
}

/** The changes under a name need a folder there: one to edit, or one to create by writing. */
function assertFolder(params: {current: TreeEntry | undefined; group: readonly PendingChange[]}) {
  const {current, group} = params;
  const path = group[0]?.path ?? '';
  const isOnlyDeletes = group.every((change) => change.content === null);
  if (current === undefined) {
    if (isOnlyDeletes) throw new ManagedCommitRefusedError('file-not-found', {path});
    return;
  }
  if (current.type === 'tree') return;
  // A file sits where the changes need a folder.
  throw new ManagedCommitRefusedError(isOnlyDeletes ? 'file-not-found' : 'path-not-allowed', {
    path,
  });
}

async function applyLeaf(params: {
  objects: ObjectFs;
  entries: Map<string, TreeEntry>;
  name: string;
  current: TreeEntry | undefined;
  change: PendingChange;
}): Promise<void> {
  const {objects, entries, name, current, change} = params;
  if (current?.type === 'tree') {
    throw new ManagedCommitRefusedError('path-not-allowed', {path: change.path});
  }
  if (change.content === null) {
    if (!current) throw new ManagedCommitRefusedError('file-not-found', {path: change.path});
    entries.delete(name);
    return;
  }
  const oid = await writeBlob({
    fs: objects.client,
    gitdir: MANAGED_GITDIR,
    blob: new TextEncoder().encode(change.content),
  });
  entries.set(name, {mode: FILE_MODE, path: name, oid, type: 'blob'});
}

function groupBySegment(
  changes: readonly PendingChange[],
  depth: number,
): Map<string, PendingChange[]> {
  const groups = new Map<string, PendingChange[]>();
  for (const change of changes) {
    const name = change.segments[depth];
    if (name === undefined) continue;
    groups.set(name, [...(groups.get(name) ?? []), change]);
  }
  return groups;
}

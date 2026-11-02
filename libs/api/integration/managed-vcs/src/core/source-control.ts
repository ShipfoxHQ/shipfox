import {
  isManagedRepositoryId,
  MANAGED_DEFAULT_BRANCH,
  MANAGED_VCS_PROVIDER,
} from '@shipfox/api-integration-managed-vcs-dto';
import {
  buildProviderRepositoryId,
  type CommitPage,
  type CommitSummary,
  decodeRepositoryFileText,
  type FetchFileInput,
  type FilePage,
  type FileSnapshot,
  type IntegrationConnection,
  IntegrationProviderError,
  isValidGitObjectId,
  isValidResolvableRef,
  type ListCommitsInput,
  type ListFilesInput,
  type ListRepositoriesInput,
  MAX_REPOSITORY_FILE_BYTES,
  parseProviderRepositoryId,
  type RepositoryPage,
  type RepositorySnapshot,
  type ResolvedRef,
  type ResolveRefInput,
  type ResolveRepositoryInput,
  type SourceControlProvider,
} from '@shipfox/api-integration-spi';
import type {CommitObject} from 'isomorphic-git';
import {getRefCommitOid} from '#db/refs.js';
import {
  getManagedRepository,
  listManagedRepositories,
  MANAGED_REPOSITORY_OWNER,
  type ManagedRepository,
} from '#db/repositories.js';
import {fileEntryType, type GitEntry, GitReader} from './git-reader.js';
import {mapStoreFailure} from './store-failure.js';

type ManagedConnection = IntegrationConnection<typeof MANAGED_VCS_PROVIDER>;

const DEFAULT_MAX_COMMITS_SCANNED = 500;
const OFFSET_CURSOR_RE = /^\d+$/u;
const COMMIT_CURSOR_SEPARATOR = ':';

export interface ManagedSourceControlProviderOptions {
  /** How many commits one `listCommits` page walks before it hands back a cursor. */
  maxCommitsScanned?: number | undefined;
}

interface PathVersion {
  oid: string;
  commit: CommitObject;
  entry: GitEntry | null;
}

export class ManagedSourceControlProvider implements SourceControlProvider<ManagedConnection> {
  private readonly maxCommitsScanned: number;

  constructor(options: ManagedSourceControlProviderOptions = {}) {
    this.maxCommitsScanned = options.maxCommitsScanned ?? DEFAULT_MAX_COMMITS_SCANNED;
  }

  async listRepositories(input: ListRepositoriesInput<ManagedConnection>): Promise<RepositoryPage> {
    const offset = parseOffset(input.cursor);
    const rows = await mapStoreFailure({
      operation: 'list-repositories',
      read: () =>
        listManagedRepositories({
          workspaceId: input.connection.workspaceId,
          search: input.search?.trim(),
          limit: input.limit + 1,
          offset,
        }),
    });
    const page = rows.slice(0, input.limit);
    return {
      repositories: page.map(toRepositorySnapshot),
      nextCursor: rows.length > page.length ? String(offset + page.length) : null,
    };
  }

  async resolveRepository(
    input: ResolveRepositoryInput<ManagedConnection>,
  ): Promise<RepositorySnapshot> {
    return await mapStoreFailure({
      operation: 'resolve-repository',
      read: async () => toRepositorySnapshot(await requireRepository(input)),
    });
  }

  async listFiles(input: ListFilesInput<ManagedConnection>): Promise<FilePage> {
    const files = await mapStoreFailure({
      operation: 'list-files',
      read: async () => {
        const repository = await requireRepository(input);
        const reader = new GitReader(repository.id);
        const commit = await readCommitAtRef({reader, repository, ref: input.ref});

        const prefix = pathSegments(input.prefix);
        const entry = await reader.findEntry(commit.tree, prefix);
        return entry ? await reader.listFiles(entry, prefix.join('/')) : [];
      },
    });

    const {cursor} = input;
    const remaining = files
      .sort((left, right) => (left.path < right.path ? -1 : 1))
      .filter((file) => cursor === undefined || file.path > cursor);
    const page = remaining.slice(0, input.limit);
    return {
      files: page.map((file) => ({...file, size: null})),
      nextCursor: remaining.length > page.length ? (page.at(-1)?.path ?? null) : null,
    };
  }

  async fetchFile(input: FetchFileInput<ManagedConnection>): Promise<FileSnapshot> {
    const bytes = await mapStoreFailure({
      operation: 'fetch-file',
      read: async () => {
        const repository = await requireRepository(input);
        const reader = new GitReader(repository.id);
        const commit = await readCommitAtRef({reader, repository, ref: input.ref});

        const entry = await reader.findEntry(commit.tree, pathSegments(input.path));
        if (entry?.type !== 'blob' || fileEntryType(entry) !== 'file') {
          throw new IntegrationProviderError(
            'file-not-found',
            `Managed file ${input.path} was not found at ${formatRef(input.ref)}`,
          );
        }
        return await reader.readBlob(entry.oid);
      },
    });

    return {path: input.path, ref: input.ref, content: decodeFile(bytes, input.path)};
  }

  resolveTriggerReference(): null {
    return null;
  }

  async resolveRef(input: ResolveRefInput<ManagedConnection>): Promise<ResolvedRef> {
    return await mapStoreFailure({
      operation: 'resolve-ref',
      read: async () => {
        const repository = await requireRepository(input);
        const commit = await resolveBranch({repositoryId: repository.id, ref: input.ref});
        return {ref: input.ref, commit};
      },
    });
  }

  async listCommits(input: ListCommitsInput<ManagedConnection>): Promise<CommitPage> {
    return await mapStoreFailure({
      operation: 'list-commits',
      read: async () => {
        const repository = await requireRepository(input);
        const reader = new GitReader(repository.id);
        const head = await resolveCommitOid({reader, repository, ref: input.ref});
        const start = await commitPageStart({reader, head, cursor: input.cursor});
        return await this.walkCommits({
          reader,
          head,
          start,
          path: pathSegments(input.path),
          limit: input.limit,
        });
      },
    });
  }

  // One id can only continue a single line of history, so the walk follows first parents.
  private async walkCommits(params: {
    reader: GitReader;
    head: string;
    start: string;
    path: readonly string[];
    limit: number;
  }): Promise<CommitPage> {
    const {reader, head, start, path, limit} = params;
    const commits: CommitSummary[] = [];
    let scanned = 0;
    let version: PathVersion | null = await readPathVersion({reader, oid: start, path});

    while (version !== null) {
      const parentOid: string | undefined = version.commit.parent[0];
      const parent: PathVersion | null =
        parentOid === undefined
          ? null
          : await readPathVersion({reader, oid: parentOid, path, child: version});
      if (!isSameEntry(version.entry, parent?.entry)) {
        commits.push(toCommitSummary(version.oid, version.commit));
      }
      scanned += 1;

      // Checked after a scan, so a cursor always moves forward.
      const isPageDone = commits.length >= limit || scanned >= this.maxCommitsScanned;
      if (parent !== null && isPageDone) {
        return {commits, nextCursor: buildCommitCursor(head, parent.oid)};
      }
      version = parent;
    }
    return {commits, nextCursor: null};
  }
}

async function requireRepository(
  input: ResolveRepositoryInput<ManagedConnection>,
): Promise<ManagedRepository> {
  const repository = isManagedRepositoryId(input.externalRepositoryId)
    ? await getManagedRepository({
        id: parseProviderRepositoryId(input.externalRepositoryId, MANAGED_VCS_PROVIDER),
        workspaceId: input.connection.workspaceId,
      })
    : undefined;
  if (!repository) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `Managed repository ${input.externalRepositoryId} was not found`,
    );
  }
  return repository;
}

async function readCommitAtRef(params: {
  reader: GitReader;
  repository: ManagedRepository;
  ref: string;
}): Promise<CommitObject> {
  return await params.reader.readCommit(await resolveCommitOid(params));
}

async function resolveCommitOid(params: {
  reader: GitReader;
  repository: ManagedRepository;
  ref: string;
}): Promise<string> {
  const {reader, repository, ref} = params;
  if (!isValidGitObjectId(ref)) return await resolveBranch({repositoryId: repository.id, ref});
  if (!(await reader.findCommit(ref))) throw refNotFound(ref);
  return ref;
}

async function resolveBranch(params: {repositoryId: string; ref: string}): Promise<string> {
  const {repositoryId, ref} = params;
  const name = ref.startsWith('refs/') ? ref : `refs/heads/${ref}`;
  // A pinned commit is not a name, and `resolveRef` only pins names.
  if (isValidGitObjectId(ref) || !isValidResolvableRef(name)) {
    throw new IntegrationProviderError(
      'ref-invalid',
      `Managed ref ${formatRef(ref)} is not a resolvable branch name`,
    );
  }
  const commit = await getRefCommitOid({repositoryId, name});
  if (!commit) throw refNotFound(ref);
  return commit;
}

/**
 * A cursor names the head it was paged from, so one from another branch can't pass as
 * this ref's history. Checking ancestry instead would walk the history on every page.
 */
async function commitPageStart(params: {
  reader: GitReader;
  head: string;
  cursor: string | undefined;
}): Promise<string> {
  const {reader, head, cursor} = params;
  if (cursor === undefined) return head;

  const [cursorHead, next] = cursor.split(COMMIT_CURSOR_SEPARATOR);
  if (cursorHead !== head || next === undefined || !(await reader.findCommit(next))) {
    throw invalidCursor(cursor);
  }
  return next;
}

function buildCommitCursor(head: string, next: string): string {
  return `${head}${COMMIT_CURSOR_SEPARATOR}${next}`;
}

async function readPathVersion(params: {
  reader: GitReader;
  oid: string;
  path: readonly string[];
  child?: PathVersion | undefined;
}): Promise<PathVersion> {
  const {reader, oid, path, child} = params;
  const commit = await reader.readCommit(oid);
  const hasChildTree = child !== undefined && child.commit.tree === commit.tree;
  const entry = hasChildTree ? child.entry : await reader.findEntry(commit.tree, path);
  return {oid, commit, entry};
}

function isSameEntry(
  left: GitEntry | null | undefined,
  right: GitEntry | null | undefined,
): boolean {
  return left?.oid === right?.oid && left?.mode === right?.mode;
}

function decodeFile(bytes: Uint8Array, path: string): string {
  if (bytes.byteLength > MAX_REPOSITORY_FILE_BYTES) {
    throw new IntegrationProviderError(
      'content-too-large',
      `Managed file ${path} is larger than the supported limit`,
    );
  }
  const content = decodeRepositoryFileText(bytes);
  if (content === null) {
    throw new IntegrationProviderError('binary-file-unsupported', `Managed file ${path} is binary`);
  }
  return content;
}

function toRepositorySnapshot(repository: ManagedRepository): RepositorySnapshot {
  return {
    externalRepositoryId: buildProviderRepositoryId(MANAGED_VCS_PROVIDER, repository.id),
    owner: MANAGED_REPOSITORY_OWNER,
    name: repository.id,
    fullName: `${MANAGED_REPOSITORY_OWNER}/${repository.id}`,
    defaultBranch: MANAGED_DEFAULT_BRANCH,
    visibility: 'private',
    cloneUrl: '',
    htmlUrl: '',
  };
}

function toCommitSummary(oid: string, commit: CommitObject): CommitSummary {
  return {
    oid,
    message: commit.message.trimEnd(),
    authorName: commit.author.name,
    authoredAt: new Date(commit.author.timestamp * 1000),
  };
}

function refNotFound(ref: string): IntegrationProviderError {
  return new IntegrationProviderError(
    'ref-not-found',
    `Managed ref ${formatRef(ref)} does not resolve to a commit`,
  );
}

function invalidCursor(cursor: string): IntegrationProviderError {
  return new IntegrationProviderError(
    'provider-rejected',
    `Managed cursor ${JSON.stringify(cursor)} is not valid for this listing`,
  );
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function formatRef(ref: string): string {
  return JSON.stringify(ref);
}

function parseOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!OFFSET_CURSOR_RE.test(cursor) || !Number.isSafeInteger(offset)) throw invalidCursor(cursor);
  return offset;
}

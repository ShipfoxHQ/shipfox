import {type FileEntryType, IntegrationProviderError} from '@shipfox/api-integration-spi';
import {reportError} from '@shipfox/node-error-monitoring';
import {
  type CommitObject,
  Errors,
  readBlob,
  readCommit,
  readTree,
  type TreeEntry,
} from 'isomorphic-git';
import {createObjectFs, MANAGED_GITDIR, type ObjectFs} from './object-fs.js';
import {MANAGED_REPOSITORY_BOUNDARY} from './store-failure.js';

const TREE_MODE = '040000';
const SYMLINK_MODE = '120000';

export type GitEntry = Pick<TreeEntry, 'mode' | 'oid' | 'type'>;

export interface GitFile {
  path: string;
  type: FileEntryType;
}

/** isomorphic-git reports a symlink as a blob, so only the mode tells them apart. */
export function fileEntryType(entry: GitEntry): FileEntryType {
  if (entry.type === 'commit') return 'submodule';
  return entry.mode === SYMLINK_MODE ? 'symlink' : 'file';
}

/** Reads one repository's objects for one operation. Every id it takes is already resolved. */
export class GitReader {
  private readonly repositoryId: string;
  private readonly objects: ObjectFs;

  constructor(repositoryId: string) {
    this.repositoryId = repositoryId;
    this.objects = createObjectFs({repositoryId});
  }

  /** For an id from a caller. Answers null when the id is no commit of this repository. */
  async findCommit(oid: string): Promise<CommitObject | null> {
    try {
      const {commit} = await readCommit({fs: this.objects.client, gitdir: MANAGED_GITDIR, oid});
      return commit;
    } catch (error) {
      if (isMissingObject(error) || error instanceof Errors.ObjectTypeError) return null;
      throw error;
    }
  }

  /** For an id the repository itself holds, where a missing object means corruption. */
  async readCommit(oid: string): Promise<CommitObject> {
    const commit = await this.findCommit(oid);
    if (!commit) throw this.missingObject(oid);
    return commit;
  }

  async readBlob(oid: string): Promise<Uint8Array> {
    return await this.readObject(oid, async () => {
      const {blob} = await readBlob({fs: this.objects.client, gitdir: MANAGED_GITDIR, oid});
      return blob;
    });
  }

  /** Walks trees by hand, so a missing path is never confused with a missing object. */
  async findEntry(rootTreeOid: string, path: readonly string[]): Promise<GitEntry | null> {
    let entry: GitEntry = {mode: TREE_MODE, oid: rootTreeOid, type: 'tree'};
    for (const segment of path) {
      if (entry.type !== 'tree') return null;
      const children = await this.readTree(entry.oid);
      const child = children.find((candidate) => candidate.path === segment);
      if (!child) return null;
      entry = child;
    }
    return entry;
  }

  async listFiles(entry: GitEntry, path: string): Promise<GitFile[]> {
    if (entry.type !== 'tree') return [{path, type: fileEntryType(entry)}];

    const files: GitFile[] = [];
    for (const child of await this.readTree(entry.oid)) {
      const childPath = path ? `${path}/${child.path}` : child.path;
      files.push(...(await this.listFiles(child, childPath)));
    }
    return files;
  }

  private async readTree(oid: string): Promise<TreeEntry[]> {
    return await this.readObject(oid, async () => {
      const {tree} = await readTree({fs: this.objects.client, gitdir: MANAGED_GITDIR, oid});
      return tree;
    });
  }

  private async readObject<T>(oid: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (isMissingObject(error)) throw this.missingObject(oid);
      throw error;
    }
  }

  private missingObject(oid: string): IntegrationProviderError {
    const error = new IntegrationProviderError(
      'provider-unavailable',
      `Managed repository ${this.repositoryId} is missing object ${oid}`,
    );
    reportError(error, {
      boundary: MANAGED_REPOSITORY_BOUNDARY,
      operation: 'read-object',
      extra: {repositoryId: this.repositoryId, oid},
    });
    return error;
  }
}

function isMissingObject(error: unknown): boolean {
  return error instanceof Errors.NotFoundError;
}

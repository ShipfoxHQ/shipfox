import {Buffer} from 'node:buffer';
import {getObjectData, type StoredObject} from '#db/objects.js';

export const MANAGED_GITDIR = '/managed.git';

const OBJECT_PATH_RE = /^\/managed\.git\/objects\/([0-9a-f]{2})\/([0-9a-f]{38})$/u;

interface ObjectFsStat {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface ObjectFsClient {
  promises: {
    readFile(path: string): Promise<Buffer>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    stat(path: string): Promise<ObjectFsStat>;
    lstat(path: string): Promise<ObjectFsStat>;
    readdir(path: string): Promise<string[]>;
    readlink(path: string): Promise<string>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
    unlink(path: string): Promise<void>;
    symlink(target: string, path: string): Promise<void>;
  };
}

export interface ObjectFs {
  /** The `fs` value for isomorphic-git. */
  client: ObjectFsClient;
  /** What the operation wrote. The caller inserts it in the transaction that moves the ref. */
  bufferedObjects(): StoredObject[];
}

/**
 * Serves git objects from Postgres and nothing else, for one operation. Reads go
 * through the write buffer first. A ref has no path here, so isomorphic-git can't
 * read or move one: callers resolve refs in Postgres and pass object ids.
 */
export function createObjectFs(params: {repositoryId: string}): ObjectFs {
  const written = new Map<string, Buffer>();
  const loaded = new Map<string, Buffer>();

  async function readFile(path: string): Promise<Buffer> {
    const oid = objectIdFromPath(path);
    if (oid === null) throw notFound(path);

    const known = written.get(oid) ?? loaded.get(oid);
    if (known) return known;

    const data = await getObjectData({repositoryId: params.repositoryId, oid});
    if (!data) throw notFound(path);
    loaded.set(oid, data);
    return data;
  }

  async function writeFile(path: string, data: Uint8Array): Promise<void> {
    const oid = objectIdFromPath(path);
    if (oid === null) throw refused(path);
    written.set(oid, Buffer.from(data));
    return await Promise.resolve();
  }

  // Reporting every object as absent makes the library write it. The insert is idempotent.
  function stat(path: string): Promise<ObjectFsStat> {
    if (path !== MANAGED_GITDIR) return Promise.reject(notFound(path));
    return Promise.resolve({isDirectory: () => true, isFile: () => false});
  }

  return {
    client: {
      promises: {
        readFile,
        writeFile,
        stat,
        lstat: stat,
        readdir: (path) => Promise.reject(notFound(path)),
        readlink: (path) => Promise.reject(notFound(path)),
        mkdir: (path) => Promise.reject(refused(path)),
        rmdir: (path) => Promise.reject(refused(path)),
        unlink: (path) => Promise.reject(refused(path)),
        symlink: (_target, path) => Promise.reject(refused(path)),
      },
    },
    bufferedObjects: () => [...written].map(([oid, data]) => ({oid, data})),
  };
}

function objectIdFromPath(path: string): string | null {
  const match = OBJECT_PATH_RE.exec(path);
  return match ? `${match[1]}${match[2]}` : null;
}

function notFound(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file, ${path}`), {code: 'ENOENT'});
}

function refused(path: string): Error {
  return new Error(`The managed object store only writes objects, refusing ${path}`);
}

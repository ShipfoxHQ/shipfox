import {createHash, randomUUID} from 'node:crypto';
import {link, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {
  assertStorageKey,
  type PutObjectParams,
  type RegistryStorage,
  StoragePreconditionFailedError,
  type StoredObject,
} from '#storage/storage.js';

const TEMPORARY_PREFIX = '.tmp-';

/**
 * Stores registry blobs under a local directory, for development and E2E. It keeps no object
 * metadata. Create-only writes are atomic across processes, because they rely on `link()`.
 */
export class FileRegistryStorage implements RegistryStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const body = await readFile(this.#path(key));
      return {body, etag: etagOf(body)};
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async put({key, body, ifNoneMatch}: PutObjectParams): Promise<{etag: string}> {
    const path = this.#path(key);
    await mkdir(dirname(path), {recursive: true});
    const temporary = join(dirname(path), `${TEMPORARY_PREFIX}${randomUUID()}`);
    try {
      await writeFile(temporary, body);
      if (ifNoneMatch === '*') {
        // link() fails when the target exists, which makes create-only atomic.
        await link(temporary, path).catch((error: unknown) => {
          if (isExisting(error)) throw new StoragePreconditionFailedError(key);
          throw error;
        });
      } else {
        await rename(temporary, path);
      }
    } finally {
      await rm(temporary, {force: true});
    }
    return {etag: etagOf(body)};
  }

  close(): void {
    // Nothing to release: every operation opens and closes its own files.
  }

  #path(key: string): string {
    return join(this.#root, ...assertStorageKey(key).split('/'));
  }
}

function etagOf(body: Buffer): string {
  return `"${createHash('sha256').update(body).digest('hex')}"`;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isExisting(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

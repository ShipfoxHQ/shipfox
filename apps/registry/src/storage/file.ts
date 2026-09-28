import {createHash, randomUUID} from 'node:crypto';
import {link, mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative, sep} from 'node:path';
import {
  assertStorageKey,
  type PutObjectParams,
  type RegistryStorage,
  StoragePreconditionFailedError,
  type StoredObject,
} from '#storage/storage.js';

const TEMPORARY_PREFIX = '.tmp-';

/**
 * Stores registry files under a local directory, for development and E2E. Conditional writes are
 * atomic within one process only, so run a single registry process on a directory.
 */
export class FileRegistryStorage implements RegistryStorage {
  readonly #root: string;
  readonly #locks = new Map<string, Promise<unknown>>();

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

  put(params: PutObjectParams): Promise<{etag: string}> {
    return this.#withLock(params.key, () => this.#put(params));
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    await this.#walk(this.#root, keys);
    return keys.filter((key) => key.startsWith(prefix)).sort();
  }

  close(): void {
    // Nothing to release: every operation opens and closes its own files.
  }

  async #put({key, body, ifNoneMatch, ifMatch}: PutObjectParams): Promise<{etag: string}> {
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
        if (ifMatch !== undefined && (await this.get(key))?.etag !== ifMatch) {
          throw new StoragePreconditionFailedError(key);
        }
        await rename(temporary, path);
      }
    } finally {
      await rm(temporary, {force: true});
    }
    return {etag: etagOf(body)};
  }

  async #walk(directory: string, keys: string[]): Promise<void> {
    const entries = await readdir(directory, {withFileTypes: true}).catch((error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.name.startsWith(TEMPORARY_PREFIX)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await this.#walk(path, keys);
      else if (entry.isFile()) keys.push(relative(this.#root, path).split(sep).join('/'));
    }
  }

  #path(key: string): string {
    return join(this.#root, ...assertStorageKey(key).split('/'));
  }

  async #withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const settled = current.catch(() => undefined);
    this.#locks.set(key, settled);
    try {
      return await current;
    } finally {
      if (this.#locks.get(key) === settled) this.#locks.delete(key);
    }
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

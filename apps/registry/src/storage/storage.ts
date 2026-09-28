export interface StoredObject {
  readonly body: Buffer;
  readonly etag: string;
}

export interface PutObjectParams {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  /** `*` writes only when the key does not exist yet. */
  readonly ifNoneMatch?: '*' | undefined;
  /** Writes only when the stored object still has this etag. */
  readonly ifMatch?: string | undefined;
}

/**
 * The registry's object store. Keys are layout paths such as `v1/index.json`; a driver maps them
 * under its own root. Conditional puts throw `StoragePreconditionFailedError`.
 */
export interface RegistryStorage {
  get(key: string): Promise<StoredObject | null>;
  put(params: PutObjectParams): Promise<{etag: string}>;
  list(prefix: string): Promise<string[]>;
  close(): void;
}

export class StoragePreconditionFailedError extends Error {
  constructor(key: string) {
    super(`Conditional write to ${key} failed`);
    this.name = 'StoragePreconditionFailedError';
  }
}

// Keys also come from request paths, so every driver refuses anything that could leave its root.
export function isStorageKey(key: string): boolean {
  const segments = key.split('/');
  return (
    key !== '' &&
    !key.includes('\\') &&
    !key.includes('\0') &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

export function assertStorageKey(key: string): string {
  if (!isStorageKey(key)) throw new TypeError(`${JSON.stringify(key)} is not a storage key`);
  return key;
}

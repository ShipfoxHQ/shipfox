export interface StoredObject {
  readonly body: Buffer;
  readonly etag: string;
}

export interface PutObjectParams {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly contentDisposition?: string | undefined;
  readonly cacheControl?: string | undefined;
  /** `*` writes only when the key does not exist yet. */
  readonly ifNoneMatch?: '*' | undefined;
}

/**
 * The registry's blob store. Keys are paths such as `blobs/sha256/<hex>`; a driver maps them under
 * its own root. A create-only put of an existing key throws `StoragePreconditionFailedError`.
 */
export interface RegistryStorage {
  get(key: string): Promise<StoredObject | null>;
  put(params: PutObjectParams): Promise<{etag: string}>;
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

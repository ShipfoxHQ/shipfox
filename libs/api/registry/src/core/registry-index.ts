/** The last good copy of a registry catalog or package index. */
export interface RegistryIndex {
  registry: string;
  /** `catalog`, or a package name. */
  key: string;
  /** The validated response body. */
  body: unknown;
  etag: string | null;
  fetchedAt: Date;
}

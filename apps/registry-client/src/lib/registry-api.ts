import {
  REGISTRY_CATALOG_PATH,
  type RegistryCatalogEntry,
  type RegistryNamespaceProfile,
  type RegistryPackageIndex,
  type RegistryPackageKind,
  type RegistryVersionDocument,
  registryCatalogSchema,
  registryEnvelopeSchema,
  registryNamespacePath,
  registryNamespaceProfileSchema,
  registryPackageIndexSchema,
  registryPackagePath,
  registryReadmePath,
  registryVersionDocumentSchema,
  registryVersionPath,
} from '@shipfox/registry-format';
import type {z} from 'zod';

/** Catalogs, indexes, and profiles change on publish, so pages see a publish within a minute. */
const MUTABLE: RequestInit = {next: {revalidate: 60}};
/** A version document and its README never change once published. */
const IMMUTABLE: RequestInit = {cache: 'force-cache'};
const TRAILING_SLASHES = /\/+$/;

export class RegistryApiError extends Error {
  override name = 'RegistryApiError';
}

/** Reads the registry API. Every page renders from it, with no metadata authored elsewhere. */
export class RegistryApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Kept without a trailing slash so a registry served under a path prefix keeps it.
    this.baseUrl = baseUrl.replace(TRAILING_SLASHES, '');
  }

  /** Every catalog entry, following the cursor across pages. */
  async listPackages(params: {kind?: RegistryPackageKind; query?: string} = {}) {
    const packages: RegistryCatalogEntry[] = [];
    let cursor: string | undefined;
    do {
      const search = new URLSearchParams();
      if (params.kind) search.set('kind', params.kind);
      if (params.query) search.set('q', params.query);
      if (cursor) search.set('cursor', cursor);
      const page = await this.json({
        path: `${REGISTRY_CATALOG_PATH}${search.size > 0 ? `?${search}` : ''}`,
        schema: registryCatalogSchema,
        init: MUTABLE,
      });
      packages.push(...(page?.packages ?? []));
      cursor = page?.next_cursor;
    } while (cursor);
    return packages;
  }

  getPackageIndex(packageName: string): Promise<RegistryPackageIndex | undefined> {
    return this.json({
      path: registryPackagePath(packageName),
      schema: registryPackageIndexSchema,
      init: MUTABLE,
    });
  }

  getNamespaceProfile(namespace: string): Promise<RegistryNamespaceProfile | undefined> {
    return this.json({
      path: registryNamespacePath(namespace),
      schema: registryNamespaceProfileSchema,
      init: MUTABLE,
    });
  }

  /**
   * The payload of a version envelope. Pages only display it, so the signature is not checked
   * here: instances verify it against their own trusted keys before they use a version.
   */
  async getVersion(params: {
    package: string;
    version: string;
  }): Promise<RegistryVersionDocument | undefined> {
    const envelope = await this.json({
      path: registryVersionPath(params),
      schema: registryEnvelopeSchema,
      init: IMMUTABLE,
    });
    if (envelope === undefined) return undefined;
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    return registryVersionDocumentSchema.parse(payload);
  }

  async getReadme(params: {package: string; version: string}): Promise<string | undefined> {
    const response = await this.fetch(registryReadmePath(params), IMMUTABLE);
    return response?.text();
  }

  private async json<Schema extends z.ZodType>({
    path,
    schema,
    init,
  }: {
    path: string;
    schema: Schema;
    init: RequestInit;
  }): Promise<z.infer<Schema> | undefined> {
    const response = await this.fetch(path, init);
    if (response === undefined) return undefined;
    return schema.parse(await response.json());
  }

  /** The response, or undefined on a 404. Any other failure throws. */
  private async fetch(path: string, init: RequestInit): Promise<Response | undefined> {
    const url = new URL(`${this.baseUrl}${path}`);
    const response = await fetch(url, init);
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new RegistryApiError(`The registry answered ${response.status} to GET ${url.pathname}`);
    }
    return response;
  }
}

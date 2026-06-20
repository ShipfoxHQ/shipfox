import {Buffer} from 'node:buffer';
import {MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-core-dto';
import {config} from '#config.js';
import {GiteaIntegrationProviderError} from '#core/errors.js';

const TRAILING_SLASHES_RE = /\/+$/;
const NEXT_PAGE_RE = /[?&]page=(\d+)/;

// Recursive tree listing is a single call; a tree larger than this is reported as
// truncated by Gitea and surfaced to the adapter as `too-many-files`.
const TREE_PAGE_SIZE = 1000;

export interface GiteaRepository {
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  cloneUrl: string;
  htmlUrl: string;
}

export interface GiteaRepositoryPage {
  repositories: GiteaRepository[];
  nextCursor: string | null;
}

export interface GiteaTreeBlob {
  path: string;
  size: number | null;
}

export interface GiteaTree {
  blobs: GiteaTreeBlob[];
  truncated: boolean;
}

export interface GiteaFileContent {
  path: string;
  content: string;
  size: number;
}

export interface GiteaApiClient {
  listOrgRepositories(input: {
    org: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GiteaRepositoryPage>;
  getRepository(input: {owner: string; repo: string}): Promise<GiteaRepository>;
  resolveRef(input: {owner: string; repo: string; ref: string}): Promise<string>;
  listTree(input: {owner: string; repo: string; sha: string}): Promise<GiteaTree>;
  fetchFileContent(input: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<GiteaFileContent>;
}

export function createGiteaApiClient(): GiteaApiClient {
  return new HttpGiteaApiClient();
}

class HttpGiteaApiClient implements GiteaApiClient {
  private cachedBaseApiUrl: string | undefined;
  private cachedAuthHeader: string | undefined;

  async listOrgRepositories(input: {
    org: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GiteaRepositoryPage> {
    const response = await this.request(`orgs/${encodeURIComponent(input.org)}/repos`, {
      page: String(cursorToPage(input.cursor)),
      limit: String(input.limit),
    });
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new GiteaIntegrationProviderError(
        'provider-unavailable',
        'Gitea repository list response was not an array',
      );
    }

    return {
      repositories: data.map(toGiteaRepository),
      nextCursor: nextCursorFromLink(response.headers.get('link')),
    };
  }

  async getRepository(input: {owner: string; repo: string}): Promise<GiteaRepository> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
    );
    return toGiteaRepository(await response.json());
  }

  async resolveRef(input: {owner: string; repo: string; ref: string}): Promise<string> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits`,
      {sha: input.ref, limit: '1', stat: 'false', verification: 'false', files: 'false'},
    );
    const data = await response.json();
    const head = Array.isArray(data) ? data[0] : undefined;
    if (!isRecord(head) || typeof head.sha !== 'string') {
      throw new GiteaIntegrationProviderError(
        'repository-not-found',
        `Gitea ref ${input.ref} did not resolve to a commit`,
      );
    }
    return head.sha;
  }

  async listTree(input: {owner: string; repo: string; sha: string}): Promise<GiteaTree> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(input.sha)}`,
      {recursive: 'true', per_page: String(TREE_PAGE_SIZE)},
    );
    const data = await response.json();
    if (!isRecord(data)) {
      throw new GiteaIntegrationProviderError(
        'provider-unavailable',
        'Gitea tree response was not an object',
      );
    }

    const entries = Array.isArray(data.tree) ? data.tree : [];
    const blobs: GiteaTreeBlob[] = [];
    for (const entry of entries) {
      if (isRecord(entry) && entry.type === 'blob' && typeof entry.path === 'string') {
        blobs.push({path: entry.path, size: typeof entry.size === 'number' ? entry.size : null});
      }
    }

    return {blobs, truncated: data.truncated === true};
  }

  async fetchFileContent(input: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<GiteaFileContent> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodePath(input.path)}`,
      {ref: input.ref},
    );
    const data = await response.json();

    // Gitea returns an array for a directory path and an object for a single file;
    // a non-file response means the requested path is not a readable file.
    if (!isRecord(data) || Array.isArray(data) || data.type !== 'file') {
      throw new GiteaIntegrationProviderError(
        'repository-not-found',
        `Gitea path ${input.path} is not a file`,
      );
    }

    const size = typeof data.size === 'number' ? data.size : 0;
    if (size > MAX_REPOSITORY_FILE_BYTES) {
      throw new GiteaIntegrationProviderError(
        'content-too-large',
        'Gitea file content is larger than the supported limit',
      );
    }
    if (typeof data.content !== 'string' || data.encoding !== 'base64') {
      throw new GiteaIntegrationProviderError(
        'provider-unavailable',
        'Gitea file response did not include base64 content',
      );
    }

    return {
      path: typeof data.path === 'string' ? data.path : input.path,
      size,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
    };
  }

  private async request(
    path: string,
    searchParams: Record<string, string> = {},
  ): Promise<Response> {
    const url = new URL(`${this.baseApiUrl()}/${path}`);
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {authorization: this.authHeader(), accept: 'application/json'},
      });
    } catch (error) {
      throw new GiteaIntegrationProviderError(
        'provider-unavailable',
        `Gitea request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) throw giteaHttpError(response);
    return response;
  }

  private baseApiUrl(): string {
    if (!this.cachedBaseApiUrl) {
      this.cachedBaseApiUrl = `${config.GITEA_BASE_URL.replace(TRAILING_SLASHES_RE, '')}/api/v1`;
    }
    return this.cachedBaseApiUrl;
  }

  private authHeader(): string {
    if (!this.cachedAuthHeader) {
      const credentials = `${config.GITEA_SERVICE_USERNAME}:${config.GITEA_SERVICE_TOKEN}`;
      this.cachedAuthHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    return this.cachedAuthHeader;
  }
}

function giteaHttpError(response: Response): GiteaIntegrationProviderError {
  const status = response.status;
  if (status === 404) {
    return new GiteaIntegrationProviderError('repository-not-found', `Gitea responded ${status}`);
  }
  if (isRateLimited(response)) {
    return new GiteaIntegrationProviderError(
      'rate-limited',
      `Gitea responded ${status}`,
      retryAfterSeconds(response),
    );
  }
  if (status === 401 || status === 403) {
    return new GiteaIntegrationProviderError('access-denied', `Gitea responded ${status}`);
  }
  // Server errors and any other unexpected status mean the provider could not
  // serve the request; surface it as unavailable rather than leaking a raw error.
  return new GiteaIntegrationProviderError('provider-unavailable', `Gitea responded ${status}`);
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
}

function retryAfterSeconds(response: Response): number | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function cursorToPage(cursor: string | undefined): number {
  if (!cursor) return 1;
  const page = Number.parseInt(cursor, 10);
  return Number.isNaN(page) || page < 1 ? 1 : page;
}

function nextCursorFromLink(link: string | null): string | null {
  if (!link) return null;
  const next = link.split(',').find((part) => part.includes('rel="next"'));
  if (!next) return null;
  const match = next.match(NEXT_PAGE_RE);
  return match?.[1] ?? null;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toGiteaRepository(raw: unknown): GiteaRepository {
  if (
    !isRecord(raw) ||
    !isRecord(raw.owner) ||
    typeof raw.owner.login !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.full_name !== 'string' ||
    typeof raw.default_branch !== 'string' ||
    typeof raw.clone_url !== 'string' ||
    typeof raw.html_url !== 'string'
  ) {
    throw new GiteaIntegrationProviderError(
      'provider-unavailable',
      'Gitea repository response is missing required fields',
    );
  }

  return {
    ownerLogin: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    defaultBranch: raw.default_branch,
    private: raw.private === true,
    cloneUrl: raw.clone_url,
    htmlUrl: raw.html_url,
  };
}

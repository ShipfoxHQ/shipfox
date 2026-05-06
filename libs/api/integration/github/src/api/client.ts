import {Buffer} from 'node:buffer';
import ky, {HTTPError, TimeoutError} from 'ky';
import {App, Octokit, RequestError} from 'octokit';
import {config, normalizedGithubPrivateKey} from '#config.js';
import {GithubIntegrationProviderError} from '#core/errors.js';

const NEXT_PAGE_RE = /[?&]page=(\d+)/;
const MAX_FILE_CONTENT_BYTES = 1_000_000;

export interface GithubAccount {
  login: string;
  type: string;
}

export interface GithubInstallationDetails {
  id: number;
  account: GithubAccount;
  repositorySelection: string;
  suspendedAt: Date | null;
  htmlUrl: string;
  raw: Record<string, unknown>;
}

export interface GithubRepository {
  id: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  visibility?: string | undefined;
  cloneUrl: string;
  htmlUrl: string;
}

export interface GithubRepositoryPage {
  repositories: GithubRepository[];
  nextCursor: string | null;
}

export interface GithubFileEntry {
  path: string;
  size: number | null;
}

export interface GithubFilePage {
  files: GithubFileEntry[];
  nextCursor: string | null;
}

export interface GithubFileContent {
  path: string;
  content: string;
  size: number;
}

export interface GithubUserInstallationPage {
  installationIds: number[];
  nextCursor: string | null;
}

export interface GithubApiClient {
  exchangeOAuthCode(code: string): Promise<string>;
  listUserInstallations(input: {
    userAccessToken: string;
    cursor?: string | undefined;
  }): Promise<GithubUserInstallationPage>;
  getInstallation(installationId: number): Promise<GithubInstallationDetails>;
  listInstallationRepositories(input: {
    installationId: number;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubRepositoryPage>;
  getRepository(input: {
    installationId: number;
    owner: string;
    repo: string;
  }): Promise<GithubRepository>;
  listRepositoryFiles(input: {
    installationId: number;
    owner: string;
    repo: string;
    ref: string;
    prefix: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubFilePage>;
  fetchRepositoryFile(input: {
    installationId: number;
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<GithubFileContent>;
}

export function createGithubApiClient(): GithubApiClient {
  return new OctokitGithubApiClient();
}

class OctokitGithubApiClient implements GithubApiClient {
  private app: App | undefined;

  async exchangeOAuthCode(code: string): Promise<string> {
    const body = await mapGithubOAuthError(() =>
      ky
        .post('https://github.com/login/oauth/access_token', {
          headers: {accept: 'application/json'},
          json: {
            client_id: config.GITHUB_APP_CLIENT_ID,
            client_secret: config.GITHUB_APP_CLIENT_SECRET,
            code,
          },
        })
        .json<{access_token?: unknown}>(),
    );

    if (typeof body.access_token !== 'string') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub OAuth response did not include an access token',
      );
    }
    return body.access_token;
  }

  async listUserInstallations(input: {
    userAccessToken: string;
    cursor?: string | undefined;
  }): Promise<GithubUserInstallationPage> {
    const octokit = new Octokit({auth: input.userAccessToken});
    const page = cursorToPage(input.cursor);
    const response = await mapGithubError(() =>
      octokit.request('GET /user/installations', {
        per_page: 100,
        page,
      }),
    );

    const installations = response.data.installations ?? [];
    return {
      installationIds: installations.map((installation) => installation.id),
      nextCursor: nextCursorFromLink(response.headers.link),
    };
  }

  async getInstallation(installationId: number): Promise<GithubInstallationDetails> {
    const response = await mapGithubError(() =>
      this.getApp().octokit.rest.apps.getInstallation({installation_id: installationId}),
    );
    const data = response.data;
    const account = data.account;
    if (!account) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation response did not include an account',
      );
    }

    const login = 'login' in account ? account.login : account.slug;
    return {
      id: data.id,
      account: {
        login,
        type: 'type' in account ? account.type : 'Enterprise',
      },
      repositorySelection: data.repository_selection,
      suspendedAt: data.suspended_at ? new Date(data.suspended_at) : null,
      htmlUrl: data.html_url,
      raw: data as unknown as Record<string, unknown>,
    };
  }

  async listInstallationRepositories(input: {
    installationId: number;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubRepositoryPage> {
    const octokit = await this.getApp().getInstallationOctokit(input.installationId);
    const page = cursorToPage(input.cursor);
    const response = await mapGithubError(() =>
      octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: input.limit,
        page,
      }),
    );

    return {
      repositories: response.data.repositories.map(toGithubRepository),
      nextCursor: nextCursorFromLink(response.headers.link),
    };
  }

  async getRepository(input: {
    installationId: number;
    owner: string;
    repo: string;
  }): Promise<GithubRepository> {
    const octokit = await this.getApp().getInstallationOctokit(input.installationId);
    const response = await mapGithubError(() =>
      octokit.rest.repos.get({
        owner: input.owner,
        repo: input.repo,
      }),
    );

    return toGithubRepository(response.data);
  }

  async listRepositoryFiles(input: {
    installationId: number;
    owner: string;
    repo: string;
    ref: string;
    prefix: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubFilePage> {
    const octokit = await this.getApp().getInstallationOctokit(input.installationId);
    const response = await mapGithubError(() =>
      octokit.rest.git.getTree({
        owner: input.owner,
        repo: input.repo,
        tree_sha: input.ref,
        recursive: 'true',
      }),
    );

    if (response.data.truncated) {
      throw new GithubIntegrationProviderError(
        'too-many-files',
        'GitHub repository tree is too large to sync safely',
      );
    }

    const files = response.data.tree
      .filter((entry) => entry.type === 'blob' && entry.path?.startsWith(input.prefix))
      .map((entry) => ({
        path: entry.path ?? '',
        size: typeof entry.size === 'number' ? entry.size : null,
      }))
      .filter((entry) => entry.path)
      .sort((a, b) => a.path.localeCompare(b.path));
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const start = Number.isNaN(offset) ? 0 : offset;
    const page = files.slice(start, start + input.limit);
    const nextOffset = start + page.length;

    return {
      files: page,
      nextCursor: nextOffset < files.length ? String(nextOffset) : null,
    };
  }

  async fetchRepositoryFile(input: {
    installationId: number;
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<GithubFileContent> {
    const octokit = await this.getApp().getInstallationOctokit(input.installationId);
    const response = await mapGithubError(
      () =>
        octokit.rest.repos.getContent({
          owner: input.owner,
          repo: input.repo,
          path: input.path,
          ref: input.ref,
        }),
      'file-not-found',
    );
    const data = response.data;

    if (Array.isArray(data) || data.type !== 'file') {
      throw new GithubIntegrationProviderError('file-not-found', 'GitHub path is not a file');
    }
    if (data.size > MAX_FILE_CONTENT_BYTES) {
      throw new GithubIntegrationProviderError(
        'content-too-large',
        'GitHub file content is larger than the supported limit',
      );
    }
    if (typeof data.content !== 'string' || data.encoding !== 'base64') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub file response did not include base64 content',
      );
    }

    return {
      path: data.path,
      size: data.size,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
    };
  }

  private getApp(): App {
    if (!this.app) {
      this.app = new App({
        appId: config.GITHUB_APP_ID,
        privateKey: normalizedGithubPrivateKey(),
      });
    }
    return this.app;
  }
}

async function mapGithubOAuthError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HTTPError) {
      if (error.response.status === 429) {
        throw new GithubIntegrationProviderError(
          'rate-limited',
          'GitHub OAuth code exchange failed',
          retryAfterSecondsFromHeaders(error.response.headers),
        );
      }
      if (error.response.status >= 500) {
        throw new GithubIntegrationProviderError(
          'provider-unavailable',
          'GitHub OAuth code exchange failed',
        );
      }
      throw new GithubIntegrationProviderError(
        'access-denied',
        'GitHub OAuth code exchange failed',
      );
    }
    if (error instanceof TimeoutError) {
      throw new GithubIntegrationProviderError('timeout', 'GitHub OAuth request timed out');
    }
    throw error;
  }
}

async function mapGithubError<T>(
  operation: () => Promise<T>,
  notFoundReason: 'repository-not-found' | 'file-not-found' = 'repository-not-found',
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GithubIntegrationProviderError) throw error;
    if (error instanceof RequestError) {
      if (error.status === 404) {
        throw new GithubIntegrationProviderError(notFoundReason, error.message);
      }
      if (error.status === 429 || isGithubRateLimitError(error)) {
        throw new GithubIntegrationProviderError(
          'rate-limited',
          error.message,
          retryAfterSeconds(error),
        );
      }
      if (error.status === 401 || error.status === 403) {
        throw new GithubIntegrationProviderError(
          'access-denied',
          error.message,
          retryAfterSeconds(error),
        );
      }
      if (error.status >= 500) {
        throw new GithubIntegrationProviderError('provider-unavailable', error.message);
      }
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GithubIntegrationProviderError('timeout', 'GitHub request timed out');
    }
    throw error;
  }
}

function isGithubRateLimitError(error: RequestError): boolean {
  return (
    error.status === 403 &&
    (error.response?.headers['x-ratelimit-remaining'] === '0' ||
      error.response?.headers['retry-after'] !== undefined)
  );
}

function retryAfterSeconds(error: RequestError): number | undefined {
  return parseRetryAfterSeconds(error.response?.headers['retry-after']);
}

function retryAfterSecondsFromHeaders(headers: Headers): number | undefined {
  return parseRetryAfterSeconds(headers.get('retry-after'));
}

function parseRetryAfterSeconds(
  retryAfter: string | number | null | undefined,
): number | undefined {
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(String(retryAfter), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function cursorToPage(cursor: string | undefined): number {
  if (!cursor) return 1;
  const page = Number.parseInt(cursor, 10);
  return Number.isNaN(page) || page < 1 ? 1 : page;
}

function nextCursorFromLink(link: string | undefined): string | null {
  if (!link) return null;
  const next = link.split(',').find((part) => part.includes('rel="next"'));
  if (!next) return null;
  const match = next.match(NEXT_PAGE_RE);
  return match?.[1] ?? null;
}

function toGithubRepository(repository: {
  id: number;
  owner: {login: string};
  name: string;
  full_name: string;
  default_branch?: string | null | undefined;
  private: boolean;
  visibility?: string | undefined;
  clone_url?: string | null | undefined;
  html_url?: string | null | undefined;
}): GithubRepository {
  if (!repository.default_branch || !repository.clone_url || !repository.html_url) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub repository response is missing required fields',
    );
  }
  return {
    id: repository.id,
    ownerLogin: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
    private: repository.private,
    visibility: repository.visibility,
    cloneUrl: repository.clone_url,
    htmlUrl: repository.html_url,
  };
}

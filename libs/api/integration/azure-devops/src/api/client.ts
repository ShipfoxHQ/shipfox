import {Buffer} from 'node:buffer';
import {
  decodeRepositoryFileText,
  type FileEntryType,
  MAX_REPOSITORY_FILE_BYTES,
} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import {AzureDevOpsIntegrationProviderError} from '#core/errors.js';

const API_VERSION = '7.1';
const CONNECTION_DATA_API_VERSION = '7.1-preview';
const TRAILING_SLASHES_RE = /\/+$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i;
// Azure DevOps organization names: letters, digits and hyphens, not starting or ending with a hyphen.
const ORGANIZATION_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/;
const HEADS_PREFIX = 'refs/heads/';
const TAGS_PREFIX = 'refs/tags/';
const GIT_SYMLINK_MODE = '120000';
const MAX_PROVIDER_ERROR_BODY_BYTES = 8 * 1024;
const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500;
// Pull request thread status 1 = active; comment type 1 = text.
const THREAD_STATUS_ACTIVE = 1;
const COMMENT_TYPE_TEXT = 1;

export type AzureDevOpsCredential = {kind: 'pat'; token: string} | {kind: 'bearer'; token: string};

export interface AzureDevOpsClientOptions {
  organization: string;
  credential: AzureDevOpsCredential;
}

export interface AzureDevOpsRepositoryRef {
  projectId: string;
  repositoryId: string;
}

export interface AzureDevOpsRepository {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  defaultBranch: string | null;
  remoteUrl: string;
  webUrl: string;
  isDisabled: boolean;
}

export interface AzureDevOpsRefCommit {
  commitSha: string;
}

export interface AzureDevOpsTreeBlob {
  path: string;
  type: FileEntryType;
  size: number | null;
}

export interface AzureDevOpsTree {
  blobs: AzureDevOpsTreeBlob[];
  truncated: boolean;
}

export interface AzureDevOpsFileContent {
  path: string;
  content: string;
  size: number;
}

export interface AzureDevOpsPullRequest {
  id: number;
  status: string;
  isDraft: boolean;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  createdBy: string | null;
  webUrl: string;
}

export interface AzureDevOpsPullRequestComment {
  threadId: number;
  commentId: number;
}

export interface AzureDevOpsConnectionData {
  authenticatedUserId: string;
  displayName: string;
}

export interface AzureDevOpsApiClient {
  getConnectionData(): Promise<AzureDevOpsConnectionData>;
  listRepositories(): Promise<AzureDevOpsRepository[]>;
  getRepository(input: AzureDevOpsRepositoryRef): Promise<AzureDevOpsRepository>;
  resolveRef(input: AzureDevOpsRepositoryRef & {ref: string}): Promise<string>;
  getBranch(input: AzureDevOpsRepositoryRef & {branch: string}): Promise<AzureDevOpsRefCommit>;
  getTag(input: AzureDevOpsRepositoryRef & {tag: string}): Promise<AzureDevOpsRefCommit>;
  listTree(input: AzureDevOpsRepositoryRef & {commitSha: string}): Promise<AzureDevOpsTree>;
  fetchFileContent(
    input: AzureDevOpsRepositoryRef & {path: string; commitSha: string},
  ): Promise<AzureDevOpsFileContent>;
  getPullRequest(
    input: AzureDevOpsRepositoryRef & {pullRequestId: number},
  ): Promise<AzureDevOpsPullRequest>;
  createPullRequest(
    input: AzureDevOpsRepositoryRef & {
      sourceBranch: string;
      targetBranch: string;
      title: string;
      description: string;
      isDraft?: boolean | undefined;
    },
  ): Promise<AzureDevOpsPullRequest>;
  createPullRequestComment(
    input: AzureDevOpsRepositoryRef & {pullRequestId: number; content: string},
  ): Promise<AzureDevOpsPullRequestComment>;
}

export function createAzureDevOpsApiClient(
  options: AzureDevOpsClientOptions,
): AzureDevOpsApiClient {
  if (!ORGANIZATION_RE.test(options.organization)) {
    throw new AzureDevOpsIntegrationProviderError(
      'provider-rejected',
      `Azure DevOps organization name is invalid: ${options.organization}`,
    );
  }
  return new HttpAzureDevOpsApiClient(options);
}

type NotFoundReason = 'repository-not-found' | 'file-not-found' | 'ref-not-found' | 'not-found';

interface RequestOptions {
  method?: string;
  searchParams?: Record<string, string>;
  body?: unknown;
  accept?: string;
  notFoundReason?: NotFoundReason;
  notFoundMessage?: string;
  apiVersion?: string;
}

class HttpAzureDevOpsApiClient implements AzureDevOpsApiClient {
  private readonly organizationUrl: string;
  private readonly authHeader: string;

  constructor(options: AzureDevOpsClientOptions) {
    const baseUrl = config.AZURE_DEVOPS_BASE_URL.replace(TRAILING_SLASHES_RE, '');
    this.organizationUrl = `${baseUrl}/${encodeURIComponent(options.organization)}`;
    this.authHeader =
      options.credential.kind === 'pat'
        ? `Basic ${Buffer.from(`:${options.credential.token}`).toString('base64')}`
        : `Bearer ${options.credential.token}`;
  }

  async getConnectionData(): Promise<AzureDevOpsConnectionData> {
    // connectionData is only served as a preview resource; a plain 7.1 request is rejected with 400.
    const data = await this.json('_apis/connectionData', {apiVersion: CONNECTION_DATA_API_VERSION});
    const user = isRecord(data) ? data.authenticatedUser : undefined;
    if (!isRecord(user) || typeof user.id !== 'string') {
      throw malformed('Azure DevOps connection data is missing the authenticated user');
    }
    const displayName =
      typeof user.providerDisplayName === 'string' ? user.providerDisplayName : user.id;
    return {authenticatedUserId: user.id, displayName};
  }

  async listRepositories(): Promise<AzureDevOpsRepository[]> {
    const data = await this.json('_apis/git/repositories');
    return listValue(data, 'repository list').map(toRepository);
  }

  async getRepository(input: AzureDevOpsRepositoryRef): Promise<AzureDevOpsRepository> {
    return toRepository(await this.json(repositoryPath(input)));
  }

  async resolveRef(input: AzureDevOpsRepositoryRef & {ref: string}): Promise<string> {
    const ref = input.ref;
    if (COMMIT_SHA_RE.test(ref)) {
      const commit = await this.getCommit({...input, commitSha: ref});
      return commit.commitId;
    }
    if (ref.startsWith(HEADS_PREFIX)) {
      return (await this.getBranch({...input, branch: ref.slice(HEADS_PREFIX.length)})).commitSha;
    }
    if (ref.startsWith(TAGS_PREFIX)) {
      return (await this.getTag({...input, tag: ref.slice(TAGS_PREFIX.length)})).commitSha;
    }
    try {
      return (await this.getBranch({...input, branch: ref})).commitSha;
    } catch (error) {
      if (
        !(error instanceof AzureDevOpsIntegrationProviderError) ||
        error.reason !== 'ref-not-found'
      ) {
        throw error;
      }
    }
    return (await this.getTag({...input, tag: ref})).commitSha;
  }

  async getBranch(
    input: AzureDevOpsRepositoryRef & {branch: string},
  ): Promise<AzureDevOpsRefCommit> {
    const ref = await this.findExactRef(input, `heads/${input.branch}`, false);
    return {commitSha: ref.objectId};
  }

  async getTag(input: AzureDevOpsRepositoryRef & {tag: string}): Promise<AzureDevOpsRefCommit> {
    const ref = await this.findExactRef(input, `tags/${input.tag}`, true);
    return {commitSha: ref.peeledObjectId ?? ref.objectId};
  }

  async listTree(input: AzureDevOpsRepositoryRef & {commitSha: string}): Promise<AzureDevOpsTree> {
    const commit = await this.getCommit(input);
    const data = await this.json(
      `${repositoryPath(input)}/trees/${encodeURIComponent(commit.treeId)}`,
      {searchParams: {recursive: 'true'}},
    );
    if (!isRecord(data) || !Array.isArray(data.treeEntries)) {
      throw malformed('Azure DevOps tree response is missing tree entries');
    }

    const blobs: AzureDevOpsTreeBlob[] = [];
    for (const entry of data.treeEntries) {
      if (!isRecord(entry) || typeof entry.relativePath !== 'string') continue;
      const type = treeEntryType(entry);
      if (type === null) continue;
      blobs.push({
        path: entry.relativePath,
        type,
        size: type !== 'submodule' && typeof entry.size === 'number' ? entry.size : null,
      });
    }
    // The trees endpoint returns the whole recursive tree in one response; it has no truncation flag.
    return {blobs, truncated: false};
  }

  async fetchFileContent(
    input: AzureDevOpsRepositoryRef & {path: string; commitSha: string},
  ): Promise<AzureDevOpsFileContent> {
    const itemPath = toItemPath(input.path);
    const response = await this.request(`${repositoryPath(input)}/items`, {
      searchParams: {
        path: itemPath,
        'versionDescriptor.version': input.commitSha,
        'versionDescriptor.versionType': 'commit',
        download: 'false',
      },
      accept: 'application/octet-stream',
      notFoundReason: 'file-not-found',
    });
    const bytes = await readBoundedBytes(response, MAX_REPOSITORY_FILE_BYTES);
    if (bytes === null) {
      throw new AzureDevOpsIntegrationProviderError(
        'content-too-large',
        'Azure DevOps file content is larger than the supported limit',
      );
    }
    const content = decodeRepositoryFileText(Buffer.from(bytes));
    if (content === null) {
      throw new AzureDevOpsIntegrationProviderError(
        'binary-file-unsupported',
        `Azure DevOps file ${input.path} is not UTF-8 text`,
      );
    }
    return {path: input.path, content, size: bytes.byteLength};
  }

  async getPullRequest(
    input: AzureDevOpsRepositoryRef & {pullRequestId: number},
  ): Promise<AzureDevOpsPullRequest> {
    const data = await this.json(`${repositoryPath(input)}/pullrequests/${input.pullRequestId}`, {
      notFoundReason: 'not-found',
      notFoundMessage: `Azure DevOps pull request ${input.pullRequestId} was not found`,
    });
    return toPullRequest(data);
  }

  async createPullRequest(
    input: AzureDevOpsRepositoryRef & {
      sourceBranch: string;
      targetBranch: string;
      title: string;
      description: string;
      isDraft?: boolean | undefined;
    },
  ): Promise<AzureDevOpsPullRequest> {
    const data = await this.json(`${repositoryPath(input)}/pullrequests`, {
      method: 'POST',
      body: {
        sourceRefName: toBranchRef(input.sourceBranch),
        targetRefName: toBranchRef(input.targetBranch),
        title: input.title,
        description: input.description,
        isDraft: input.isDraft ?? true,
      },
    });
    return toPullRequest(data);
  }

  async createPullRequestComment(
    input: AzureDevOpsRepositoryRef & {pullRequestId: number; content: string},
  ): Promise<AzureDevOpsPullRequestComment> {
    const data = await this.json(
      `${repositoryPath(input)}/pullRequests/${input.pullRequestId}/threads`,
      {
        method: 'POST',
        body: {
          comments: [{parentCommentId: 0, content: input.content, commentType: COMMENT_TYPE_TEXT}],
          status: THREAD_STATUS_ACTIVE,
        },
        notFoundReason: 'not-found',
        notFoundMessage: `Azure DevOps pull request ${input.pullRequestId} was not found`,
      },
    );
    const comment = isRecord(data) && Array.isArray(data.comments) ? data.comments[0] : undefined;
    if (
      !isRecord(data) ||
      typeof data.id !== 'number' ||
      !isRecord(comment) ||
      typeof comment.id !== 'number'
    ) {
      throw malformed('Azure DevOps comment thread response is missing its ids');
    }
    return {threadId: data.id, commentId: comment.id};
  }

  private async getCommit(
    input: AzureDevOpsRepositoryRef & {commitSha: string},
  ): Promise<{commitId: string; treeId: string}> {
    const data = await this.json(
      `${repositoryPath(input)}/commits/${encodeURIComponent(input.commitSha)}`,
      {notFoundReason: 'ref-not-found'},
    );
    if (!isRecord(data) || typeof data.commitId !== 'string' || typeof data.treeId !== 'string') {
      throw malformed('Azure DevOps commit response is missing the commit or tree id');
    }
    return {commitId: data.commitId, treeId: data.treeId};
  }

  // The refs filter is a prefix match (`heads/main` also returns `heads/main-old`), so pick the exact name.
  private async findExactRef(
    input: AzureDevOpsRepositoryRef,
    filter: string,
    peelTags: boolean,
  ): Promise<{objectId: string; peeledObjectId: string | null}> {
    const searchParams: Record<string, string> = {filter};
    if (peelTags) searchParams.peelTags = 'true';
    const data = await this.json(`${repositoryPath(input)}/refs`, {
      searchParams,
      notFoundReason: 'ref-not-found',
    });
    const wanted = `refs/${filter}`;
    for (const ref of listValue(data, 'ref list')) {
      if (!isRecord(ref) || ref.name !== wanted) continue;
      if (typeof ref.objectId !== 'string') {
        throw malformed(`Azure DevOps ref ${wanted} is missing its object id`);
      }
      return {
        objectId: ref.objectId,
        peeledObjectId: typeof ref.peeledObjectId === 'string' ? ref.peeledObjectId : null,
      };
    }
    throw new AzureDevOpsIntegrationProviderError(
      'ref-not-found',
      `Azure DevOps ref ${wanted} was not found`,
    );
  }

  private async json(path: string, options: RequestOptions = {}): Promise<unknown> {
    const response = await this.request(path, {accept: 'application/json', ...options});
    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw malformed('Azure DevOps response was not JSON');
    }
    try {
      return await response.json();
    } catch {
      throw malformed('Azure DevOps response was not valid JSON');
    }
  }

  private requestInit(options: RequestOptions): RequestInit {
    const headers: Record<string, string> = {
      authorization: this.authHeader,
      accept: options.accept ?? 'application/json',
    };
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      // A redirect means the credential was bounced to a sign-in page; never follow it.
      redirect: 'manual',
      signal: AbortSignal.timeout(config.AZURE_DEVOPS_REQUEST_TIMEOUT_MS),
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return init;
  }

  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(`${this.organizationUrl}/${path}`);
    for (const [key, value] of Object.entries(options.searchParams ?? {})) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('api-version', options.apiVersion ?? API_VERSION);

    const response = await sendRequest(url, this.requestInit(options));
    // Azure DevOps answers some requests with an invalid or expired credential with a 203 HTML
    // sign-in page or a redirect to it, instead of a 401.
    if (response.status === 203 || (response.status >= 300 && response.status < 400)) {
      throw new AzureDevOpsIntegrationProviderError(
        'access-denied',
        'Azure DevOps redirected to a sign-in page; the credential is invalid or expired',
        undefined,
        response.status,
      );
    }
    if (!response.ok) {
      throw await httpError(
        response,
        options.notFoundReason ?? 'repository-not-found',
        options.notFoundMessage,
      );
    }
    return response;
  }
}

async function sendRequest(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    // A bare `fetch` has no request timeout; AbortSignal.timeout turns an unresponsive Azure DevOps
    // into a fast `timeout` instead of holding the worker open.
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AzureDevOpsIntegrationProviderError('timeout', 'Azure DevOps request timed out');
    }
    throw new AzureDevOpsIntegrationProviderError(
      'provider-unavailable',
      `Azure DevOps request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function repositoryPath(input: AzureDevOpsRepositoryRef): string {
  return `${encodeURIComponent(input.projectId)}/_apis/git/repositories/${encodeURIComponent(input.repositoryId)}`;
}

function toBranchRef(branch: string): string {
  return branch.startsWith(HEADS_PREFIX) ? branch : `${HEADS_PREFIX}${branch}`;
}

function fromBranchRef(ref: string): string {
  return ref.startsWith(HEADS_PREFIX) ? ref.slice(HEADS_PREFIX.length) : ref;
}

// Item paths are absolute within the repository. `..`, `.` and empty segments are rejected so a
// workflow path can never address something outside what the caller asked for.
function toItemPath(path: string): string {
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new AzureDevOpsIntegrationProviderError(
        'file-not-found',
        `Azure DevOps path contains an invalid segment: ${path}`,
      );
    }
  }
  return `/${path}`;
}

// Git stores a symlink as a blob with mode 120000 and a submodule as a commit entry.
function treeEntryType(entry: Record<string, unknown>): FileEntryType | null {
  if (entry.gitObjectType === 'commit') return 'submodule';
  if (entry.gitObjectType !== 'blob') return null;
  return entry.mode === GIT_SYMLINK_MODE ? 'symlink' : 'file';
}

function listValue(data: unknown, what: string): unknown[] {
  if (!isRecord(data) || !Array.isArray(data.value)) {
    throw malformed(`Azure DevOps ${what} response is missing its value array`);
  }
  return data.value;
}

function toRepository(raw: unknown): AzureDevOpsRepository {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    !isRecord(raw.project) ||
    typeof raw.project.id !== 'string' ||
    typeof raw.project.name !== 'string' ||
    typeof raw.remoteUrl !== 'string' ||
    typeof raw.webUrl !== 'string'
  ) {
    throw malformed('Azure DevOps repository response is missing required fields');
  }
  return {
    id: raw.id,
    name: raw.name,
    projectId: raw.project.id,
    projectName: raw.project.name,
    defaultBranch: typeof raw.defaultBranch === 'string' ? fromBranchRef(raw.defaultBranch) : null,
    remoteUrl: raw.remoteUrl,
    webUrl: raw.webUrl,
    isDisabled: raw.isDisabled === true,
  };
}

function toPullRequest(raw: unknown): AzureDevOpsPullRequest {
  if (
    !isRecord(raw) ||
    typeof raw.pullRequestId !== 'number' ||
    typeof raw.status !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.sourceRefName !== 'string' ||
    typeof raw.targetRefName !== 'string' ||
    !isRecord(raw.repository) ||
    typeof raw.repository.webUrl !== 'string'
  ) {
    throw malformed('Azure DevOps pull request response is missing required fields');
  }
  const createdBy =
    isRecord(raw.createdBy) && typeof raw.createdBy.displayName === 'string'
      ? raw.createdBy.displayName
      : null;
  return {
    id: raw.pullRequestId,
    status: raw.status,
    isDraft: raw.isDraft === true,
    title: raw.title,
    description: typeof raw.description === 'string' ? raw.description : '',
    sourceBranch: fromBranchRef(raw.sourceRefName),
    targetBranch: fromBranchRef(raw.targetRefName),
    createdBy,
    webUrl: `${raw.repository.webUrl}/pullrequest/${raw.pullRequestId}`,
  };
}

async function httpError(
  response: Response,
  notFoundReason: NotFoundReason,
  notFoundMessage?: string,
): Promise<AzureDevOpsIntegrationProviderError> {
  const status = response.status;
  const fallback =
    status === 404 && notFoundMessage ? notFoundMessage : `Azure DevOps responded ${status}`;
  const message =
    status >= 400 && status < 500 ? await responseErrorMessage(response, fallback) : fallback;
  if (status === 404) {
    return new AzureDevOpsIntegrationProviderError(notFoundReason, message, undefined, status);
  }
  if (status === 429) {
    return new AzureDevOpsIntegrationProviderError(
      'rate-limited',
      message,
      retryAfterSeconds(response),
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new AzureDevOpsIntegrationProviderError('access-denied', message, undefined, status);
  }
  if (status >= 400 && status < 500) {
    return new AzureDevOpsIntegrationProviderError('provider-rejected', message, undefined, status);
  }
  // Server errors and redirects mean the provider could not serve the request; never leak their body.
  return new AzureDevOpsIntegrationProviderError(
    'provider-unavailable',
    message,
    undefined,
    status,
  );
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  let body: string;
  try {
    const bytes = await readBoundedBytes(response, MAX_PROVIDER_ERROR_BODY_BYTES, true);
    body = new TextDecoder().decode(bytes ?? new Uint8Array());
  } catch {
    return fallback;
  }
  const trimmed = body.trim();
  if (!trimmed) return fallback;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed) && typeof parsed.message === 'string' && parsed.message.trim()) {
      return `${fallback}: ${truncate(parsed.message)}`;
    }
  } catch {
    // Fall through to the bounded raw text below.
  }
  return `${fallback}: ${truncate(trimmed)}`;
}

// Reads at most `limit` bytes. Returns null when the body is larger than the limit, unless
// `truncateOverflow` is set, in which case the first `limit` bytes are returned.
async function readBoundedBytes(
  response: Response,
  limit: number,
  truncateOverflow = false,
): Promise<Uint8Array | null> {
  const body = response.body;
  if (!body) return new Uint8Array();

  const {chunks, overflow} = await readChunks(body.getReader(), limit, truncateOverflow);
  if (overflow && !truncateOverflow) return null;
  return concatChunks(chunks);
}

async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
  keepPrefixOnOverflow: boolean,
): Promise<{chunks: Uint8Array[]; overflow: boolean}> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done || !value) return {chunks, overflow: false};
      if (byteLength + value.byteLength > limit) {
        if (keepPrefixOnOverflow) chunks.push(value.subarray(0, limit - byteLength));
        await reader.cancel();
        return {chunks, overflow: true};
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let byteLength = 0;
  for (const chunk of chunks) byteLength += chunk.byteLength;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function truncate(value: string): string {
  const codePoints = [...value];
  return codePoints.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH
    ? `${codePoints.slice(0, MAX_PROVIDER_ERROR_MESSAGE_LENGTH - 3).join('')}...`
    : value;
}

function retryAfterSeconds(response: Response): number | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('application/json') === true;
}

function malformed(message: string): AzureDevOpsIntegrationProviderError {
  return new AzureDevOpsIntegrationProviderError('malformed-provider-response', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

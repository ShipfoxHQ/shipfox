import {isValidGitObjectId} from '@shipfox/api-integration-spi';
import {mapGithubError} from '#api/client.js';
import type {GithubToolClient, GithubToolResponse} from './agent-tools.js';
import {GithubIntegrationProviderError} from './errors.js';
import {GIT_TREE_ENTRY_MODES} from './github-agent-tool-catalog.js';

/** GitHub rejects larger blobs on its Git database API. */
export const MAX_GIT_BLOB_BYTES = 40 * 1024 * 1024;

const SUBMODULE_MODE = '160000';
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
const UNPAIRED_SURROGATE_PATTERN = /[\uD800-\uDFFF]/u;
const NOT_FAST_FORWARD_PATTERN = /not a fast[ -]forward/iu;
const REFERENCE_MISSING_PATTERN = /reference does not exist/iu;
const REFERENCE_EXISTS_PATTERN = /already exists/iu;

const BLOB_ROUTE = 'POST /repos/{owner}/{repo}/git/blobs';
const GET_COMMIT_ROUTE = 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}';
const TREE_ROUTE = 'POST /repos/{owner}/{repo}/git/trees';
const COMMIT_ROUTE = 'POST /repos/{owner}/{repo}/git/commits';
const GET_BRANCH_ROUTE = 'GET /repos/{owner}/{repo}/git/ref/heads/{branch}';
const DELETE_BRANCH_ROUTE = 'DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}';
const GET_REPOSITORY_ROUTE = 'GET /repos/{owner}/{repo}';
const UPDATE_BRANCH_ROUTE = 'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}';
const CREATE_REF_ROUTE = 'POST /repos/{owner}/{repo}/git/refs';

function isSafeRepositoryPath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (containsControlCharacter(path)) return false;
  return path.split('/').every((segment) => {
    return segment.length > 0 && segment !== '.' && segment !== '..' && segment !== '.git';
  });
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateCreateBlobArguments(
  arguments_: Record<string, unknown>,
): string | undefined {
  if (!isRepository(arguments_.repository)) {
    return 'Parameter repository must be a repository in owner/name format';
  }
  const {contents, encoding} = arguments_;
  if (typeof contents !== 'string') return 'Parameter contents must be a string';
  if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'base64') {
    return 'Parameter encoding must be utf8 or base64';
  }
  if (encoding === 'base64') {
    if (contents.length % 4 !== 0 || !BASE64_PATTERN.test(contents)) {
      return 'Parameter contents must be well-formed base64 when encoding is base64';
    }
    if (base64DecodedByteLength(contents) > MAX_GIT_BLOB_BYTES) return blobTooLarge('contents');
    return undefined;
  }
  if (UNPAIRED_SURROGATE_PATTERN.test(contents)) {
    return 'Parameter contents must be well-formed text; send binary contents as base64';
  }
  return Buffer.byteLength(contents, 'utf8') > MAX_GIT_BLOB_BYTES
    ? blobTooLarge('contents')
    : undefined;
}

export function validateDeleteBranchArguments(
  arguments_: Record<string, unknown>,
): string | undefined {
  if (!isRepository(arguments_.repository)) {
    return 'Parameter repository must be a repository in owner/name format';
  }
  const branch = arguments_.branch;
  if (typeof branch !== 'string' || branch.trim().length === 0 || branch.startsWith('refs/')) {
    return 'Parameter branch must be a non-empty branch name without a refs/ prefix';
  }
  const expectedHeadOid = arguments_.expected_head_oid;
  return expectedHeadOid !== undefined &&
    (typeof expectedHeadOid !== 'string' || !isValidGitObjectId(expectedHeadOid))
    ? 'Parameter expected_head_oid must be a 40- or 64-character commit oid'
    : undefined;
}

export function validateCreateCommitArguments(
  arguments_: Record<string, unknown>,
): string | undefined {
  if (!isRepository(arguments_.repository)) {
    return 'Parameter repository must be a repository in owner/name format';
  }
  const branch = arguments_.branch;
  if (typeof branch !== 'string' || branch.trim().length === 0 || branch.startsWith('refs/')) {
    return 'Parameter branch must be a non-empty branch name without a refs/ prefix';
  }
  const parentOid = arguments_.parent_oid;
  if (typeof parentOid !== 'string' || !isValidGitObjectId(parentOid)) {
    return 'Parameter parent_oid must be a 40- or 64-character commit oid';
  }
  const message = arguments_.message;
  if (typeof message !== 'string' || message.trim().length === 0) {
    return 'Parameter message must be a non-empty string';
  }
  const invalidMove = validateBranchMove(arguments_);
  if (invalidMove !== undefined) return invalidMove;
  const entries = arguments_.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return 'Parameter entries must hold at least one tree entry';
  }
  for (const entry of entries) {
    const invalid = validateTreeEntry(entry);
    if (invalid !== undefined) return invalid;
  }
  return undefined;
}

function validateBranchMove(arguments_: Record<string, unknown>): string | undefined {
  const expectedHeadOid = arguments_.expected_head_oid;
  if (
    expectedHeadOid !== undefined &&
    (typeof expectedHeadOid !== 'string' || !isValidGitObjectId(expectedHeadOid))
  ) {
    return 'Parameter expected_head_oid must be a 40- or 64-character commit oid';
  }
  return arguments_.force !== undefined && typeof arguments_.force !== 'boolean'
    ? 'Parameter force must be a boolean'
    : undefined;
}

function validateTreeEntry(entry: unknown): string | undefined {
  if (!isRecord(entry) || typeof entry.path !== 'string' || !isSafeRepositoryPath(entry.path)) {
    return 'Every entry needs a safe repository-relative path';
  }
  const invalid =
    validateTreeEntrySource(entry) ?? validateTreeEntryMode(entry) ?? validateTreeEntryData(entry);
  return invalid === undefined ? undefined : `Entry ${entry.path}: ${invalid}`;
}

function validateTreeEntrySource(entry: Record<string, unknown>): string | undefined {
  if (entry.delete !== undefined && typeof entry.delete !== 'boolean') {
    return 'delete must be a boolean';
  }
  const sources = [entry.oid !== undefined, entry.contents !== undefined, entry.delete === true];
  return sources.filter(Boolean).length === 1
    ? undefined
    : 'set exactly one of oid, contents, or delete';
}

function validateTreeEntryMode(entry: Record<string, unknown>): string | undefined {
  const mode = entry.mode;
  if (
    mode !== undefined &&
    !GIT_TREE_ENTRY_MODES.includes(mode as (typeof GIT_TREE_ENTRY_MODES)[number])
  ) {
    return `mode must be one of ${GIT_TREE_ENTRY_MODES.join(', ')}`;
  }
  return mode === SUBMODULE_MODE && entry.oid === undefined && entry.delete !== true
    ? 'a submodule entry needs the oid of its commit'
    : undefined;
}

function validateTreeEntryData(entry: Record<string, unknown>): string | undefined {
  const {oid, contents} = entry;
  if (oid !== undefined && (typeof oid !== 'string' || !isValidGitObjectId(oid))) {
    return 'oid must be a 40- or 64-character object id';
  }
  if (contents === undefined) return undefined;
  if (typeof contents !== 'string' || UNPAIRED_SURROGATE_PATTERN.test(contents)) {
    return 'contents must be well-formed text; upload binary contents with create_blob';
  }
  return Buffer.byteLength(contents, 'utf8') > MAX_GIT_BLOB_BYTES
    ? blobTooLarge('contents')
    : undefined;
}

export async function createGitBlob(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
): Promise<GithubToolResponse> {
  const {owner, repo} = splitRepository(parameters.repository);
  return await request(client, BLOB_ROUTE, {
    owner,
    repo,
    content: parameters.contents,
    encoding: parameters.encoding === 'base64' ? 'base64' : 'utf-8',
  });
}

/**
 * Builds a tree on top of the parent commit's tree, commits it, and moves the branch to the
 * commit. The commit carries no author or committer, so GitHub signs it as the app's bot.
 */
export async function createCommit(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
): Promise<GithubToolResponse> {
  const {owner, repo} = splitRepository(parameters.repository);
  const branch = String(parameters.branch);
  const parentOid = String(parameters.parent_oid);
  const entries = Array.isArray(parameters.entries) ? parameters.entries.filter(isRecord) : [];

  const baseTree = await parentTreeOid(client, {owner, repo, parentOid});
  const tree = await request(client, TREE_ROUTE, {
    owner,
    repo,
    base_tree: baseTree,
    tree: entries.map(treeEntry),
  });
  const commit = await request(client, COMMIT_ROUTE, {
    owner,
    repo,
    message: parameters.message,
    tree: responseSha(tree, 'tree'),
    parents: [parentOid],
  });
  const oid = responseSha(commit, 'commit');
  if (typeof parameters.expected_head_oid === 'string') {
    await assertBranchHead(client, {
      owner,
      repo,
      branch,
      expectedHeadOid: parameters.expected_head_oid,
    });
  }
  await moveBranch(client, {
    owner,
    repo,
    branch,
    oid,
    parentOid,
    force: parameters.force === true,
  });
  return {...commit, data: {...(isRecord(commit.data) ? commit.data : {}), branch}};
}

/** Deletes a branch. A branch that is already gone is a success, so a retry is safe. */
export async function deleteBranch(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
): Promise<GithubToolResponse> {
  const {owner, repo} = splitRepository(parameters.repository);
  const branch = String(parameters.branch);
  const repository = await request(client, GET_REPOSITORY_ROUTE, {owner, repo});
  if (isRecord(repository.data) && repository.data.default_branch === branch) {
    throw new GithubIntegrationProviderError(
      'provider-rejected',
      `Branch ${branch} is the default branch of ${owner}/${repo} and cannot be deleted`,
      undefined,
      422,
      'protected-branch',
    );
  }
  const head = await branchHead(client, {owner, repo, branch});
  if (head === undefined) return {data: {branch, existed: false, oid: null}};
  const expectedHeadOid = parameters.expected_head_oid;
  if (typeof expectedHeadOid === 'string' && head.toLowerCase() !== expectedHeadOid.toLowerCase()) {
    throw staleExpectedHead({branch, expectedHeadOid, head});
  }
  try {
    await request(client, DELETE_BRANCH_ROUTE, {owner, repo, branch});
  } catch (error) {
    // Another caller deleted the branch after the read above.
    if (!isUnprocessable(error) || !REFERENCE_MISSING_PATTERN.test(error.message)) throw error;
    return {data: {branch, existed: false, oid: null}};
  }
  return {data: {branch, existed: true, oid: head}};
}

export function projectCreateBlobOutput(data: unknown): Record<string, unknown> {
  if (!isRecord(data) || typeof data.sha !== 'string') {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub blob response did not include a sha',
    );
  }
  return {oid: data.sha};
}

export function projectCreateCommitOutput(data: unknown): Record<string, unknown> {
  if (!isRecord(data) || typeof data.sha !== 'string' || typeof data.html_url !== 'string') {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub commit response did not include a sha and url',
    );
  }
  const verified = isRecord(data.verification) && data.verification.verified === true;
  return {commit: {oid: data.sha, url: data.html_url, verified}, branch: data.branch};
}

async function parentTreeOid(
  client: GithubToolClient,
  params: {owner: string; repo: string; parentOid: string},
): Promise<string> {
  const {owner, repo, parentOid} = params;
  try {
    const parent = await request(client, GET_COMMIT_ROUTE, {owner, repo, commit_sha: parentOid});
    const tree = isRecord(parent.data) ? parent.data.tree : undefined;
    return responseSha({data: tree}, 'parent commit tree');
  } catch (error) {
    if (!(error instanceof GithubIntegrationProviderError) || error.status !== 404) throw error;
    throw new GithubIntegrationProviderError(
      'provider-rejected',
      `Commit ${parentOid} does not exist in repository ${owner}/${repo}; parent_oid must be a commit GitHub already has`,
      undefined,
      error.status,
    );
  }
}

// GitHub's ref update takes no expected old value, so the check and the update are two requests.
async function assertBranchHead(
  client: GithubToolClient,
  params: {owner: string; repo: string; branch: string; expectedHeadOid: string},
): Promise<void> {
  const head = await branchHead(client, params);
  if (head?.toLowerCase() === params.expectedHeadOid.toLowerCase()) return;
  throw staleExpectedHead({...params, head});
}

/** The commit a branch points at, or `undefined` when the branch does not exist. */
async function branchHead(
  client: GithubToolClient,
  params: {owner: string; repo: string; branch: string},
): Promise<string | undefined> {
  const {owner, repo, branch} = params;
  try {
    const ref = await request(client, GET_BRANCH_ROUTE, {owner, repo, branch});
    const object = isRecord(ref.data) ? ref.data.object : undefined;
    return isRecord(object) && typeof object.sha === 'string' ? object.sha : undefined;
  } catch (error) {
    if (error instanceof GithubIntegrationProviderError && error.status === 404) return undefined;
    throw error;
  }
}

function staleExpectedHead(params: {
  branch: string;
  expectedHeadOid: string;
  head: string | undefined;
}): GithubIntegrationProviderError {
  const {branch, expectedHeadOid, head} = params;
  return new GithubIntegrationProviderError(
    'provider-rejected',
    `Stale branch head (stale-head): expected_head_oid ${expectedHeadOid} did not match branch ${branch}, which ${head === undefined ? 'does not exist' : `points at ${head}`}.`,
    undefined,
    422,
    'stale-head',
  );
}

async function moveBranch(
  client: GithubToolClient,
  params: {
    owner: string;
    repo: string;
    branch: string;
    oid: string;
    parentOid: string;
    force: boolean;
  },
): Promise<void> {
  const {owner, repo, branch, oid, force} = params;
  try {
    await request(client, UPDATE_BRANCH_ROUTE, {owner, repo, branch, sha: oid, force});
    return;
  } catch (error) {
    if (!isUnprocessable(error)) throw error;
    if (NOT_FAST_FORWARD_PATTERN.test(error.message)) throw staleHead(params, error);
    if (!REFERENCE_MISSING_PATTERN.test(error.message)) throw error;
  }
  try {
    await request(client, CREATE_REF_ROUTE, {owner, repo, ref: `refs/heads/${branch}`, sha: oid});
  } catch (error) {
    // The branch appeared between the two requests, so it no longer matches what the caller saw.
    if (isUnprocessable(error) && REFERENCE_EXISTS_PATTERN.test(error.message)) {
      throw staleHead(params, error);
    }
    throw error;
  }
}

function staleHead(
  params: {branch: string; parentOid: string},
  error: GithubIntegrationProviderError,
): GithubIntegrationProviderError {
  return new GithubIntegrationProviderError(
    'provider-rejected',
    `Stale branch head (stale-head): branch ${params.branch} moved and no longer fast-forwards from parent_oid ${params.parentOid}. ${error.message}`,
    undefined,
    error.status,
    'stale-head',
  );
}

function isUnprocessable(error: unknown): error is GithubIntegrationProviderError {
  return error instanceof GithubIntegrationProviderError && error.status === 422;
}

function treeEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const mode = typeof entry.mode === 'string' ? entry.mode : '100644';
  const base = {path: entry.path, mode, type: mode === SUBMODULE_MODE ? 'commit' : 'blob'};
  if (entry.delete === true) return {...base, sha: null};
  return entry.oid === undefined ? {...base, content: entry.contents} : {...base, sha: entry.oid};
}

async function request(
  client: GithubToolClient,
  route: string,
  parameters: Record<string, unknown>,
): Promise<GithubToolResponse> {
  return await mapGithubError(() => client.request(route, parameters), 'provider-rejected');
}

function responseSha(response: {data: unknown}, subject: string): string {
  const sha = isRecord(response.data) ? response.data.sha : undefined;
  if (typeof sha !== 'string' || !isValidGitObjectId(sha)) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      `GitHub ${subject} response did not include a sha`,
    );
  }
  return sha;
}

function splitRepository(value: unknown): {owner: string; repo: string} {
  const [owner = '', repo = ''] = String(value).split('/');
  return {owner, repo};
}

function isRepository(value: unknown): value is string {
  return typeof value === 'string' && REPOSITORY_PATTERN.test(value);
}

function base64DecodedByteLength(value: string): number {
  const decoded = (value.length / 4) * 3;
  if (value.endsWith('==')) return decoded - 2;
  return value.endsWith('=') ? decoded - 1 : decoded;
}

function blobTooLarge(subject: string): string {
  return `${subject} is above the ${MAX_GIT_BLOB_BYTES} bytes GitHub accepts for one file`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

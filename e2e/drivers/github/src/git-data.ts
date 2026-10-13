import {createHash} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {RecordedWrite} from '@shipfox/e2e-core';
import {botLogin} from './bot.js';
import type {GithubCommitFixture} from './commits.js';
import {isRecord, readJsonBody, sendJson} from './http.js';

const BLOBS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/blobs$/u;
const TREES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/trees$/u;
const COMMITS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/commits$/u;
const COMMIT_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/commits\/([0-9a-f]+)$/u;
const BRANCH_REF_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/u;
const READ_BRANCH_REF_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/heads\/(.+)$/u;
const REFS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/u;
const BRANCH_PREFIX = 'refs/heads/';

const WRITE_ROUTES = [
  {kind: 'blob', method: 'POST', path: BLOBS_PATH},
  {kind: 'tree', method: 'POST', path: TREES_PATH},
  {kind: 'commit', method: 'POST', path: COMMITS_PATH},
  {kind: 'ref', method: 'PATCH', path: BRANCH_REF_PATH},
  {kind: 'create-ref', method: 'POST', path: REFS_PATH},
  {kind: 'delete-ref', method: 'DELETE', path: BRANCH_REF_PATH},
] as const;

/** A commit as it reached a branch: the parent it was built on and the files it changed. */
export interface GitDataCommit {
  repository: string;
  branch: string;
  parentOid: string;
  message: string;
  force: boolean;
  /** Contents are base64, whichever way the caller sent them. */
  additions: {path: string; mode: string; contents: string}[];
  deletions: {path: string}[];
}

export interface GitDataRoutesOptions {
  /** Branch tips by branch name. A branch moves only on a fast-forward or a forced update. */
  branchHeads: Map<string, string>;
  /** Commits by id. A commit made through the API joins them, so the commit reads find it. */
  commits: Map<string, GithubCommitFixture>;
  recordCommit(commit: GitDataCommit, accepted: boolean, authorization: string | undefined): void;
  /** Called for every accepted write, with the request's authorization header. */
  recordWrite(write: RecordedWrite, authorization: string | undefined): void;
}

export interface GitDataRoutes {
  handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL): Promise<boolean>;
}

interface StoredCommit {
  repository: string;
  parentOid: string;
  message: string;
  entries: Record<string, unknown>[];
}

/**
 * GitHub's Git database writes: blobs, trees, commits, and branch updates. Objects are kept in
 * memory and a commit is recorded when a branch update asks for it, accepted or not.
 */
export function createGitDataRoutes(options: GitDataRoutesOptions): GitDataRoutes {
  const blobs = new Map<string, string>();
  const trees = new Map<string, Record<string, unknown>[]>();
  const commits = new Map<string, StoredCommit>();

  function toCommit(commit: StoredCommit, branch: string, force: boolean): GitDataCommit {
    const additions: GitDataCommit['additions'] = [];
    const deletions: GitDataCommit['deletions'] = [];
    for (const entry of commit.entries) {
      const path = String(entry.path);
      if (entry.sha === null) {
        deletions.push({path});
        continue;
      }
      const contents =
        typeof entry.content === 'string'
          ? Buffer.from(entry.content, 'utf8').toString('base64')
          : (blobs.get(String(entry.sha)) ?? '');
      additions.push({path, mode: String(entry.mode), contents});
    }
    return {
      repository: commit.repository,
      branch,
      parentOid: commit.parentOid,
      message: commit.message,
      force,
      additions,
      deletions,
    };
  }

  function readCommit(response: ServerResponse, match: RegExpMatchArray): void {
    const sha = match[3] ?? '';
    sendJson(response, 200, {sha, tree: {sha: oid({tree: sha})}});
  }

  function createBlob(response: ServerResponse, body: Record<string, unknown>): void {
    const content = String(body.content ?? '');
    const base64 =
      body.encoding === 'base64' ? content : Buffer.from(content, 'utf8').toString('base64');
    const sha = blobOid(Buffer.from(base64, 'base64'));
    blobs.set(sha, base64);
    sendJson(response, 201, {sha});
  }

  function createTree(response: ServerResponse, body: Record<string, unknown>): void {
    const sha = oid(body);
    trees.set(sha, Array.isArray(body.tree) ? body.tree.filter(isRecord) : []);
    sendJson(response, 201, {sha});
  }

  function createCommit(
    response: ServerResponse,
    body: Record<string, unknown>,
    match: RegExpMatchArray,
  ): void {
    const repository = `${match[1]}/${match[2]}`;
    const sha = oid(body);
    const parents = Array.isArray(body.parents) ? body.parents.map(String) : [];
    commits.set(sha, {
      repository,
      parentOid: parents[0] ?? '',
      message: String(body.message ?? ''),
      entries: trees.get(String(body.tree)) ?? [],
    });
    // GitHub signs a commit without an author as the app, which shows as verified.
    options.commits.set(sha, {
      repository,
      message: String(body.message ?? ''),
      parents,
      author: botLogin(),
      verified: true,
    });
    sendJson(response, 201, {
      sha,
      html_url: `https://github.com/${repository}/commit/${sha}`,
      verification: {verified: true, reason: 'valid'},
    });
  }

  function moveBranch(
    response: ServerResponse,
    body: Record<string, unknown>,
    match: RegExpMatchArray,
    authorization: string | undefined,
  ): void {
    const branch = decodeURIComponent(match[3] ?? '');
    const sha = String(body.sha);
    const commit = commits.get(sha);
    const head = options.branchHeads.get(branch);
    if (head === undefined || commit === undefined) {
      sendJson(response, 422, {message: 'Reference does not exist'});
      return;
    }
    const force = body.force === true;
    // Like GitHub, a branch moves only to a commit built on its tip, unless forced.
    const accepted = force || head === commit.parentOid;
    options.recordCommit(toCommit(commit, branch, force), accepted, authorization);
    if (!accepted) {
      sendJson(response, 422, {message: 'Update is not a fast forward'});
      return;
    }
    options.branchHeads.set(branch, sha);
    options.recordWrite(
      {
        kind: 'github.create_commit',
        target: `${commit.repository}:${branch}`,
        payload: {
          repository: commit.repository,
          branch,
          parent_oid: commit.parentOid,
          oid: sha,
          message: commit.message,
          force,
        },
      },
      authorization,
    );
    sendJson(response, 200, {ref: `refs/heads/${branch}`, object: {sha, type: 'commit'}});
  }

  function refPayload(match: RegExpMatchArray, branch: string, sha: string) {
    const api = `https://api.github.com/repos/${match[1]}/${match[2]}`;
    return {
      ref: `${BRANCH_PREFIX}${branch}`,
      node_id: `REF_${branch}`,
      url: `${api}/git/refs/heads/${branch}`,
      object: {sha, type: 'commit', url: `${api}/git/commits/${sha}`},
    };
  }

  function readBranchRef(response: ServerResponse, match: RegExpMatchArray): void {
    const branch = decodeURIComponent(match[3] ?? '');
    const sha = options.branchHeads.get(branch);
    if (sha === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    sendJson(response, 200, refPayload(match, branch, sha));
  }

  function createRef(
    response: ServerResponse,
    body: Record<string, unknown>,
    match: RegExpMatchArray,
    authorization: string | undefined,
  ): void {
    const ref = typeof body.ref === 'string' ? body.ref : '';
    const sha = typeof body.sha === 'string' ? body.sha : '';
    if (!ref.startsWith(BRANCH_PREFIX) || ref.length === BRANCH_PREFIX.length || sha === '') {
      sendJson(response, 422, {message: 'Validation Failed'});
      return;
    }
    const branch = ref.slice(BRANCH_PREFIX.length);
    if (options.branchHeads.has(branch)) {
      sendJson(response, 422, {message: 'Reference already exists'});
      return;
    }
    const repository = `${match[1]}/${match[2]}`;
    // A tip taken from a git repository the fake serves is no fixture, so the reads need one.
    if (!options.commits.has(sha)) options.commits.set(sha, {repository, message: `Commit ${sha}`});
    options.branchHeads.set(branch, sha);
    options.recordWrite(
      {
        kind: 'github.create_branch',
        target: `${repository}:${branch}`,
        payload: {repository, branch, sha},
      },
      authorization,
    );
    sendJson(response, 201, refPayload(match, branch, sha));
  }

  function deleteBranchRef(
    response: ServerResponse,
    match: RegExpMatchArray,
    authorization: string | undefined,
  ): void {
    const branch = decodeURIComponent(match[3] ?? '');
    if (!options.branchHeads.delete(branch)) {
      sendJson(response, 422, {message: 'Reference does not exist'});
      return;
    }
    const repository = `${match[1]}/${match[2]}`;
    options.recordWrite(
      {
        kind: 'github.delete_branch',
        target: `${repository}:${branch}`,
        payload: {repository, branch},
      },
      authorization,
    );
    response.writeHead(204).end();
  }

  function handleRead(request: IncomingMessage, response: ServerResponse, path: string): boolean {
    if (request.method !== 'GET') return false;
    const commitMatch = path.match(COMMIT_PATH);
    if (commitMatch !== null) readCommit(response, commitMatch);
    const readRefMatch = path.match(READ_BRANCH_REF_PATH);
    if (readRefMatch !== null) readBranchRef(response, readRefMatch);
    return commitMatch !== null || readRefMatch !== null;
  }

  return {
    async handle(request, response, requestUrl) {
      const path = requestUrl.pathname;
      if (handleRead(request, response, path)) return true;
      const write = WRITE_ROUTES.find(
        (route) => route.method === request.method && route.path.test(path),
      );
      if (write === undefined) return false;
      const match = path.match(write.path) as RegExpMatchArray;
      const authorization = request.headers.authorization;
      if (write.kind === 'delete-ref') {
        deleteBranchRef(response, match, authorization);
        return true;
      }
      const body = await readJsonBody(request);
      if (write.kind === 'blob') createBlob(response, body);
      else if (write.kind === 'tree') createTree(response, body);
      else if (write.kind === 'commit') createCommit(response, body, match);
      else if (write.kind === 'create-ref') createRef(response, body, match, authorization);
      else moveBranch(response, body, match, authorization);
      return true;
    },
  };
}

// A blob's id is the Git hash of its contents, so it is the same one GitHub gives.
function blobOid(contents: Buffer): string {
  return createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex');
}

function oid(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

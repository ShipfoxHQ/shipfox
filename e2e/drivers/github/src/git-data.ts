import {createHash} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {isRecord, readJsonBody, sendJson} from './http.js';

const BLOBS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/blobs$/u;
const TREES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/trees$/u;
const COMMITS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/commits$/u;
const COMMIT_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/commits\/([0-9a-f]+)$/u;
const BRANCH_REF_PATH = /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/u;

const WRITE_ROUTES = [
  {kind: 'blob', method: 'POST', path: BLOBS_PATH},
  {kind: 'tree', method: 'POST', path: TREES_PATH},
  {kind: 'commit', method: 'POST', path: COMMITS_PATH},
  {kind: 'ref', method: 'PATCH', path: BRANCH_REF_PATH},
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
  recordCommit(commit: GitDataCommit, accepted: boolean, authorization: string | undefined): void;
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
    const sha = oid({blob: base64});
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
    commits.set(sha, {
      repository,
      parentOid: String(Array.isArray(body.parents) ? body.parents[0] : ''),
      message: String(body.message ?? ''),
      entries: trees.get(String(body.tree)) ?? [],
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
    sendJson(response, 200, {ref: `refs/heads/${branch}`, object: {sha, type: 'commit'}});
  }

  return {
    async handle(request, response, requestUrl) {
      const path = requestUrl.pathname;
      const commitMatch = path.match(COMMIT_PATH);
      if (request.method === 'GET' && commitMatch !== null) {
        readCommit(response, commitMatch);
        return true;
      }
      const write = WRITE_ROUTES.find(
        (route) => route.method === request.method && route.path.test(path),
      );
      if (write === undefined) return false;
      const match = path.match(write.path) as RegExpMatchArray;
      const body = await readJsonBody(request);
      if (write.kind === 'blob') createBlob(response, body);
      else if (write.kind === 'tree') createTree(response, body);
      else if (write.kind === 'commit') createCommit(response, body, match);
      else moveBranch(response, body, match, request.headers.authorization);
      return true;
    },
  };
}

function oid(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

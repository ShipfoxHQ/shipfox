import {createHash} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {paginate, sendJson} from './http.js';
import {sameRepository} from './pull-requests.js';

const BRANCH_PATH = /^\/repos\/([^/]+)\/([^/]+)\/branches\/([^/]+)$/u;
const COMMIT_PATH = /^\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)$/u;
const COMMIT_STATUS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)\/status$/u;
const COMMIT_CHECK_RUNS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)\/check-runs$/u;
const BASEHEAD_SEPARATOR = /\.{2,3}/u;
const COMPARE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/compare\/(.+)$/u;

const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';
const FIXTURE_ACTOR_ID = 5_000_001;
const FIXTURE_CHECK_RUN_ID_BASE = 3_000_000;
const DEFAULT_AUTHOR = 'e2e-author';

export interface GithubCheckRunFixture {
  name: string;
  /** Defaults to `completed`. */
  status?: 'queued' | 'in_progress' | 'completed' | undefined;
  /** Defaults to `success` for a completed check run. */
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | undefined;
}

export interface GithubCommitStatusFixture {
  context: string;
  state: 'error' | 'failure' | 'pending' | 'success';
}

export interface GithubCommitFixture {
  /** Repository the commit belongs to, as `owner/repo`. */
  repository: string;
  message: string;
  /** Parent commit ids, first parent first. A commit without parents is a root commit. */
  parents?: string[] | undefined;
  /** Login of the author and committer. Defaults to `e2e-author`. */
  author?: string | undefined;
  /** Check runs that report on this commit. */
  checkRuns?: GithubCheckRunFixture[] | undefined;
  /** Commit statuses that report on this commit. */
  statuses?: GithubCommitStatusFixture[] | undefined;
}

export interface CommitRoutesOptions {
  /** Commits by id. */
  commits: ReadonlyMap<string, GithubCommitFixture>;
  /** Branch tips by branch name. */
  branchHeads: ReadonlyMap<string, string>;
}

export interface CommitRoutes {
  /** Answers the request and returns true when it is a branch, commit, status, or compare read. */
  handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL): boolean;
}

interface Resolved {
  sha: string;
  commit: GithubCommitFixture;
}

function repositoryOf(match: RegExpMatchArray): string {
  return `${decodeURIComponent(match[1] ?? '')}/${decodeURIComponent(match[2] ?? '')}`;
}

function actor(login: string): Record<string, unknown> {
  return {
    login,
    id: FIXTURE_ACTOR_ID,
    type: 'User',
    site_admin: false,
    html_url: `https://github.com/${login}`,
  };
}

function signature(login: string): Record<string, unknown> {
  return {name: login, email: `${login}@users.noreply.github.com`, date: FIXTURE_TIMESTAMP};
}

function commitPayload(repository: string, {sha, commit}: Resolved): Record<string, unknown> {
  const login = commit.author ?? DEFAULT_AUTHOR;
  const api = `https://api.github.com/repos/${repository}`;
  return {
    sha,
    node_id: `C_${sha}`,
    url: `${api}/commits/${sha}`,
    html_url: `https://github.com/${repository}/commit/${sha}`,
    commit: {
      url: `${api}/git/commits/${sha}`,
      author: signature(login),
      committer: signature(login),
      message: commit.message,
      tree: {
        sha: createHash('sha1').update(`tree:${sha}`).digest('hex'),
        url: `${api}/git/trees/${sha}`,
      },
      comment_count: 0,
      verification: {verified: false, reason: 'unsigned', signature: null, payload: null},
    },
    author: actor(login),
    committer: actor(login),
    parents: (commit.parents ?? []).map((parent) => ({
      sha: parent,
      url: `${api}/commits/${parent}`,
      html_url: `https://github.com/${repository}/commit/${parent}`,
    })),
  };
}

function combinedState(statuses: readonly GithubCommitStatusFixture[]): string {
  if (statuses.some((status) => status.state === 'failure' || status.state === 'error')) {
    return 'failure';
  }
  if (statuses.length === 0 || statuses.some((status) => status.state === 'pending')) {
    return 'pending';
  }
  return 'success';
}

/**
 * The commit reads of the repository API: a branch, a commit by id or branch name, the combined
 * status and check runs of a commit, and the comparison of two commits. The commits are the
 * fixtures a test registers, not the objects of a git repository, so a test can give a branch the
 * ids the sandbox holds.
 */
export function createCommitRoutes({commits, branchHeads}: CommitRoutesOptions): CommitRoutes {
  function resolve(repository: string, reference: string): Resolved | undefined {
    const wanted = decodeURIComponent(reference);
    const sha = commits.has(wanted) ? wanted : branchHeads.get(wanted);
    const commit = sha === undefined ? undefined : commits.get(sha);
    if (sha === undefined || commit === undefined) return undefined;
    return sameRepository(commit.repository, repository) ? {sha, commit} : undefined;
  }

  function getBranch(match: RegExpMatchArray, response: ServerResponse) {
    const repository = repositoryOf(match);
    const name = decodeURIComponent(match[3] ?? '');
    const tip = branchHeads.has(name) ? resolve(repository, name) : undefined;
    if (tip === undefined) {
      sendJson(response, 404, {message: 'Branch not found', status: '404'});
      return;
    }
    sendJson(response, 200, {
      name,
      commit: commitPayload(repository, tip),
      protected: false,
    });
  }

  function getCommit(match: RegExpMatchArray, response: ServerResponse) {
    const repository = repositoryOf(match);
    const found = resolve(repository, match[3] ?? '');
    if (found === undefined) {
      sendJson(response, 422, {
        message: `No commit found for SHA: ${decodeURIComponent(match[3] ?? '')}`,
        status: '422',
      });
      return;
    }
    sendJson(response, 200, commitPayload(repository, found));
  }

  function getStatus(match: RegExpMatchArray, response: ServerResponse) {
    const repository = repositoryOf(match);
    const found = resolve(repository, match[3] ?? '');
    if (found === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    const statuses = found.commit.statuses ?? [];
    sendJson(response, 200, {
      state: combinedState(statuses),
      statuses: statuses.map((status, index) => ({
        id: index + 1,
        context: status.context,
        state: status.state,
        description: null,
        target_url: null,
        created_at: FIXTURE_TIMESTAMP,
        updated_at: FIXTURE_TIMESTAMP,
      })),
      sha: found.sha,
      total_count: statuses.length,
      commit_url: `https://api.github.com/repos/${repository}/commits/${found.sha}`,
      url: `https://api.github.com/repos/${repository}/commits/${found.sha}/status`,
    });
  }

  function checkRunId(sha: string, index: number): number {
    const position = [...commits.keys()].indexOf(sha);
    return FIXTURE_CHECK_RUN_ID_BASE + position * 100 + index;
  }

  function listCheckRuns(
    match: RegExpMatchArray,
    response: ServerResponse,
    searchParams: URLSearchParams,
  ) {
    const repository = repositoryOf(match);
    const found = resolve(repository, match[3] ?? '');
    if (found === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    const checkRuns = (found.commit.checkRuns ?? []).map((checkRun, index) => {
      const status = checkRun.status ?? 'completed';
      const id = checkRunId(found.sha, index);
      return {
        id,
        node_id: `CR_${id}`,
        head_sha: found.sha,
        name: checkRun.name,
        status,
        conclusion: status === 'completed' ? (checkRun.conclusion ?? 'success') : null,
        started_at: FIXTURE_TIMESTAMP,
        completed_at: status === 'completed' ? FIXTURE_TIMESTAMP : null,
        url: `https://api.github.com/repos/${repository}/check-runs/${id}`,
        html_url: `https://github.com/${repository}/runs/${id}`,
        app: {slug: 'github-actions', name: 'GitHub Actions'},
      };
    });
    sendJson(response, 200, {
      total_count: checkRuns.length,
      check_runs: paginate(checkRuns, searchParams),
    });
  }

  // The commits the head has and the base does not, oldest first, along the first parents. It is
  // undefined when the base is not on that line.
  function commitsAhead({
    repository,
    base,
    head,
  }: {
    repository: string;
    base: Resolved;
    head: Resolved;
  }): Resolved[] | undefined {
    const ahead: Resolved[] = [];
    let cursor: Resolved | undefined = head;
    while (cursor !== undefined && cursor.sha !== base.sha) {
      ahead.unshift(cursor);
      const parent: string | undefined = cursor.commit.parents?.[0];
      cursor = parent === undefined ? undefined : resolve(repository, parent);
    }
    return cursor === undefined ? undefined : ahead;
  }

  function compare(
    match: RegExpMatchArray,
    response: ServerResponse,
    searchParams: URLSearchParams,
  ) {
    const repository = repositoryOf(match);
    const [baseReference, headReference] = decodeURIComponent(match[3] ?? '').split(
      BASEHEAD_SEPARATOR,
    );
    const base = baseReference === undefined ? undefined : resolve(repository, baseReference);
    const head = headReference === undefined ? undefined : resolve(repository, headReference);
    if (base === undefined || head === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    const ahead = commitsAhead({repository, base, head});
    if (ahead === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    sendJson(response, 200, {
      url: `https://api.github.com/repos/${repository}/compare/${base.sha}...${head.sha}`,
      html_url: `https://github.com/${repository}/compare/${base.sha}...${head.sha}`,
      status: ahead.length === 0 ? 'identical' : 'ahead',
      ahead_by: ahead.length,
      behind_by: 0,
      total_commits: ahead.length,
      base_commit: commitPayload(repository, base),
      merge_base_commit: commitPayload(repository, base),
      commits: paginate(
        ahead.map((commit) => commitPayload(repository, commit)),
        searchParams,
      ),
      files: [],
    });
  }

  return {
    handle(request, response, requestUrl) {
      if (request.method !== 'GET') return false;
      const {pathname, searchParams} = requestUrl;
      const branchMatch = pathname.match(BRANCH_PATH);
      if (branchMatch !== null) getBranch(branchMatch, response);
      const statusMatch = pathname.match(COMMIT_STATUS_PATH);
      if (statusMatch !== null) getStatus(statusMatch, response);
      const checkRunsMatch = pathname.match(COMMIT_CHECK_RUNS_PATH);
      if (checkRunsMatch !== null) listCheckRuns(checkRunsMatch, response, searchParams);
      const commitMatch = pathname.match(COMMIT_PATH);
      if (commitMatch !== null) getCommit(commitMatch, response);
      const compareMatch = pathname.match(COMPARE_PATH);
      if (compareMatch !== null) compare(compareMatch, response, searchParams);
      return [branchMatch, statusMatch, checkRunsMatch, commitMatch, compareMatch].some(
        (match) => match !== null,
      );
    },
  };
}

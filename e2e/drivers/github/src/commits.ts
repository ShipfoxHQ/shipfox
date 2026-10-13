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
  /** Set by the fake to a number of its own. A seeded check run needs none. */
  id?: number | undefined;
  name: string;
  /** Defaults to `completed`. */
  status?: 'queued' | 'in_progress' | 'completed' | undefined;
  /** Defaults to `success` for a completed check run. */
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | undefined;
  output?: GithubCheckRunOutputFixture | undefined;
}

export interface GithubCheckRunOutputFixture {
  title?: string | null | undefined;
  summary?: string | null | undefined;
  text?: string | null | undefined;
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
  /** Whether GitHub verifies the signature of the commit. Defaults to false. */
  verified?: boolean | undefined;
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
  const treeSha = createHash('sha1').update(`tree:${sha}`).digest('hex');
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
      tree: {sha: treeSha, url: `${api}/git/trees/${treeSha}`},
      comment_count: 0,
      verification: commit.verified
        ? {verified: true, reason: 'valid', signature: null, payload: null}
        : {verified: false, reason: 'unsigned', signature: null, payload: null},
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

/** The commit and every commit it descends from, following all parents. */
export function ancestorsOf(
  commits: ReadonlyMap<string, GithubCommitFixture>,
  sha: string,
): Set<string> {
  const seen = new Set<string>();
  const pending = [sha];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(commits.get(next)?.parents ?? []));
  }
  return seen;
}

/** A check run as the REST API returns it. */
export function checkRunPayload({
  repository,
  sha,
  id,
  checkRun,
}: {
  repository: string;
  sha: string;
  id: number;
  checkRun: GithubCheckRunFixture;
}): Record<string, unknown> {
  const status = checkRun.status ?? 'completed';
  return {
    id,
    node_id: `CR_${id}`,
    head_sha: sha,
    name: checkRun.name,
    status,
    conclusion: status === 'completed' ? (checkRun.conclusion ?? 'success') : null,
    started_at: FIXTURE_TIMESTAMP,
    completed_at: status === 'completed' ? FIXTURE_TIMESTAMP : null,
    output: {
      title: checkRun.output?.title ?? null,
      summary: checkRun.output?.summary ?? null,
      text: checkRun.output?.text ?? null,
      annotations_count: 0,
    },
    url: `https://api.github.com/repos/${repository}/check-runs/${id}`,
    html_url: `https://github.com/${repository}/runs/${id}`,
    app: {slug: 'github-actions', name: 'GitHub Actions'},
  };
}

function comparisonStatus({ahead, behind}: {ahead: number; behind: number}): string {
  if (ahead === 0 && behind === 0) return 'identical';
  if (behind === 0) return 'ahead';
  return ahead === 0 ? 'behind' : 'diverged';
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
    const tip = branchHeads.has(name) ? resolve(repository, match[3] ?? '') : undefined;
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
    const checkRuns = (found.commit.checkRuns ?? []).map((checkRun, index) =>
      checkRunPayload({
        repository,
        sha: found.sha,
        id: checkRun.id ?? checkRunId(found.sha, index),
        checkRun,
      }),
    );
    sendJson(response, 200, {
      total_count: checkRuns.length,
      check_runs: paginate(checkRuns, searchParams),
    });
  }

  // The commits the head has and the base does not, parents before children, and the nearest
  // commit both sides share. The history may hold merge commits, so it follows every parent.
  function diverge({
    repository,
    base,
    head,
  }: {
    repository: string;
    base: Resolved;
    head: Resolved;
  }): {ahead: Resolved[]; behind: number; mergeBase: Resolved} | undefined {
    const baseAncestors = ancestorsOf(commits, base.sha);
    const headAncestors = ancestorsOf(commits, head.sha);
    const ahead: Resolved[] = [];
    const visited = new Set<string>();
    const visit = (sha: string) => {
      const commit = commits.get(sha);
      if (visited.has(sha) || baseAncestors.has(sha) || commit === undefined) return;
      visited.add(sha);
      for (const parent of commit.parents ?? []) visit(parent);
      ahead.push({sha, commit});
    };
    visit(head.sha);

    const mergeBase = nearestShared({repository, head, shared: baseAncestors});
    if (mergeBase === undefined) return undefined;
    const behind = [...baseAncestors].filter((ancestor) => !headAncestors.has(ancestor)).length;
    return {ahead, behind, mergeBase};
  }

  // The nearest commit of the head's history that the other side has too, walking breadth first.
  function nearestShared({
    repository,
    head,
    shared,
  }: {
    repository: string;
    head: Resolved;
    shared: ReadonlySet<string>;
  }): Resolved | undefined {
    const queue = [head.sha];
    for (const sha of queue) {
      if (shared.has(sha)) return resolve(repository, sha);
      for (const parent of commits.get(sha)?.parents ?? []) {
        if (!queue.includes(parent)) queue.push(parent);
      }
    }
    return undefined;
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
    const diverged =
      base === undefined || head === undefined ? undefined : diverge({repository, base, head});
    if (base === undefined || head === undefined || diverged === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    const {ahead, behind, mergeBase} = diverged;
    sendJson(response, 200, {
      url: `https://api.github.com/repos/${repository}/compare/${base.sha}...${head.sha}`,
      html_url: `https://github.com/${repository}/compare/${base.sha}...${head.sha}`,
      status: comparisonStatus({ahead: ahead.length, behind}),
      ahead_by: ahead.length,
      behind_by: behind,
      total_commits: ahead.length,
      base_commit: commitPayload(repository, base),
      merge_base_commit: commitPayload(repository, mergeBase),
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

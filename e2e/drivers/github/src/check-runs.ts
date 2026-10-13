import {
  checkRunPayload,
  type GithubCheckRunFixture,
  type GithubCheckRunOutputFixture,
  type GithubCommitFixture,
} from './commits.js';
import {isRecord} from './http.js';
import {sameRepository} from './pull-requests.js';

const FIRST_CHECK_RUN_ID = 4_000_000;
const STATUSES = ['queued', 'in_progress', 'completed'] as const;
const CONCLUSIONS = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
] as const;

export type CheckRunResult =
  | {status: 200 | 201; body: Record<string, unknown>; sha: string; id: number}
  | {status: 404 | 422; body: Record<string, unknown>};

export interface CheckRunStore {
  /** Adds a check run to the commit `head_sha` names, which must be a commit of the repository. */
  create(params: {repository: string; body: Record<string, unknown>}): CheckRunResult;
  /** Changes a check run of the repository, or answers 404 when it has none by that id. */
  update(params: {repository: string; id: number; body: Record<string, unknown>}): CheckRunResult;
  has(params: {repository: string; id: number}): boolean;
}

/**
 * The check runs a client creates through the API. They live on the commit they report on, next
 * to the seeded ones, so the commit reads list them.
 */
export function createCheckRunStore(
  commits: ReadonlyMap<string, GithubCommitFixture>,
): CheckRunStore {
  let nextId = FIRST_CHECK_RUN_ID;

  function find(repository: string, id: number) {
    for (const [sha, commit] of commits) {
      if (!sameRepository(commit.repository, repository)) continue;
      const checkRun = commit.checkRuns?.find((candidate) => candidate.id === id);
      if (checkRun !== undefined) return {sha, checkRun};
    }
    return undefined;
  }

  function invalid(field: string, code = 'invalid'): CheckRunResult {
    return {
      status: 422,
      body: {message: 'Validation Failed', errors: [{resource: 'CheckRun', field, code}]},
    };
  }

  // Applies the fields of a create or update request, or names the field GitHub would reject.
  function apply(checkRun: GithubCheckRunFixture, body: Record<string, unknown>) {
    const rejected = applyName(checkRun, body) ?? applyState(checkRun, body);
    if (rejected !== undefined) return rejected;
    if (isRecord(body.output)) checkRun.output = outputOf(body.output, checkRun.output);
    return checkRun.status === 'completed' && checkRun.conclusion === undefined
      ? 'conclusion'
      : undefined;
  }

  return {
    create({repository, body}) {
      const sha = typeof body.head_sha === 'string' ? body.head_sha : '';
      const commit = commits.get(sha);
      if (commit === undefined || !sameRepository(commit.repository, repository)) {
        return {status: 422, body: {message: `No commit found for SHA: ${sha}`}};
      }
      if (typeof body.name !== 'string' || body.name === '')
        return invalid('name', 'missing_field');
      const checkRun: GithubCheckRunFixture = {
        id: nextId,
        name: body.name,
        // A check run starts queued, unless the request says more.
        status: body.conclusion === undefined ? 'queued' : 'completed',
      };
      const rejected = apply(checkRun, body);
      if (rejected !== undefined) return invalid(rejected);
      nextId += 1;
      commit.checkRuns = [...(commit.checkRuns ?? []), checkRun];
      return {
        status: 201,
        sha,
        id: checkRun.id as number,
        body: checkRunPayload({repository, sha, id: checkRun.id as number, checkRun}),
      };
    },
    update({repository, id, body}) {
      const found = find(repository, id);
      if (found === undefined) return {status: 404, body: {message: 'Not Found'}};
      const changed = {...found.checkRun};
      const rejected = apply(changed, body);
      if (rejected !== undefined) return invalid(rejected);
      Object.assign(found.checkRun, changed);
      return {
        status: 200,
        sha: found.sha,
        id,
        body: checkRunPayload({repository, sha: found.sha, id, checkRun: found.checkRun}),
      };
    },
    has({repository, id}) {
      return find(repository, id) !== undefined;
    },
  };
}

function applyName(checkRun: GithubCheckRunFixture, body: Record<string, unknown>) {
  if (body.name === undefined) return undefined;
  if (typeof body.name !== 'string' || body.name === '') return 'name';
  checkRun.name = body.name;
  return undefined;
}

function applyState(checkRun: GithubCheckRunFixture, body: Record<string, unknown>) {
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as (typeof STATUSES)[number])) return 'status';
    checkRun.status = body.status as (typeof STATUSES)[number];
  }
  if (body.conclusion !== undefined) {
    if (!CONCLUSIONS.includes(body.conclusion as (typeof CONCLUSIONS)[number])) return 'conclusion';
    checkRun.conclusion = body.conclusion as (typeof CONCLUSIONS)[number];
  }
  return undefined;
}

function outputOf(
  value: Record<string, unknown>,
  current: GithubCheckRunOutputFixture | undefined,
): GithubCheckRunOutputFixture {
  const text = (field: string) => (typeof value[field] === 'string' ? value[field] : undefined);
  return {
    title: text('title') ?? current?.title,
    summary: text('summary') ?? current?.summary,
    text: text('text') ?? current?.text,
  };
}

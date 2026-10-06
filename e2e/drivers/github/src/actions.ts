import type {IncomingMessage, ServerResponse} from 'node:http';
import {paginate, sendJson} from './http.js';
import {sameRepository} from './pull-requests.js';

const WORKFLOWS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows$/u;
const WORKFLOW_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/]+)$/u;
const WORKFLOW_RUNS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/]+)\/runs$/u;

const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';
const FIXTURE_ACTOR_ID = 5_000_001;

export interface GithubWorkflowFixture {
  /** Repository the workflow belongs to, as `owner/repo`. */
  repository: string;
  name: string;
  /** Workflow file name, such as `ci.yml`. The workflow's path is `.github/workflows/<file>`. */
  file: string;
  /** Defaults to `active`. */
  state?: 'active' | 'disabled_manually' | undefined;
}

export interface GithubWorkflowRunFixture {
  /** Id of the workflow in `workflows`. */
  workflowId: number;
  /** Defaults to `main`. */
  branch?: string | undefined;
  sha: string;
  /** Defaults to `push`. */
  event?: string | undefined;
  /** Defaults to `completed`. */
  status?: 'queued' | 'in_progress' | 'completed' | undefined;
  /** Defaults to `success` for a completed run. */
  conclusion?: 'success' | 'failure' | 'cancelled' | undefined;
}

export interface ActionsRoutesOptions {
  /** Workflows by id. */
  workflows: ReadonlyMap<number, GithubWorkflowFixture>;
  /** Workflow runs by id. Run numbers follow the id order within each workflow. */
  workflowRuns: ReadonlyMap<number, GithubWorkflowRunFixture>;
}

export interface ActionsRoutes {
  /** Answers the request and returns true when it is a workflow or workflow run list route. */
  handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL): boolean;
}

function repositoryOf(match: RegExpMatchArray): string {
  return `${decodeURIComponent(match[1] ?? '')}/${decodeURIComponent(match[2] ?? '')}`;
}

function workflowPayload(id: number, workflow: GithubWorkflowFixture): Record<string, unknown> {
  const path = `.github/workflows/${workflow.file}`;
  return {
    id,
    node_id: `W_${id}`,
    name: workflow.name,
    path,
    state: workflow.state ?? 'active',
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    url: `https://api.github.com/repos/${workflow.repository}/actions/workflows/${id}`,
    html_url: `https://github.com/${workflow.repository}/blob/main/${path}`,
    badge_url: `https://github.com/${workflow.repository}/workflows/${workflow.name}/badge.svg`,
  };
}

function workflowRunPayload({
  id,
  run,
  runNumber,
  workflowId,
  workflow,
}: {
  id: number;
  run: GithubWorkflowRunFixture;
  runNumber: number;
  workflowId: number;
  workflow: GithubWorkflowFixture;
}): Record<string, unknown> {
  const status = run.status ?? 'completed';
  const actor = {
    login: 'e2e-author',
    id: FIXTURE_ACTOR_ID,
    type: 'User',
    html_url: 'https://github.com/e2e-author',
  };
  return {
    id,
    name: workflow.name,
    node_id: `WFR_${id}`,
    head_branch: run.branch ?? 'main',
    head_sha: run.sha,
    path: `.github/workflows/${workflow.file}`,
    display_title: workflow.name,
    run_number: runNumber,
    run_attempt: 1,
    event: run.event ?? 'push',
    status,
    conclusion: status === 'completed' ? (run.conclusion ?? 'success') : null,
    workflow_id: workflowId,
    url: `https://api.github.com/repos/${workflow.repository}/actions/runs/${id}`,
    html_url: `https://github.com/${workflow.repository}/actions/runs/${id}`,
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    run_started_at: FIXTURE_TIMESTAMP,
    actor,
    triggering_actor: actor,
  };
}

/**
 * The workflow routes of the Actions API: the workflows of a repository, one workflow by id or
 * file name, and the runs of a workflow. A workflow no test seeded has never run, so its run
 * list is empty, as it is before the event that starts a case.
 */
export function createActionsRoutes({
  workflows,
  workflowRuns,
}: ActionsRoutesOptions): ActionsRoutes {
  function findWorkflow(repository: string, reference: string) {
    const wanted = decodeURIComponent(reference);
    return [...workflows.entries()].find(
      ([id, workflow]) =>
        sameRepository(workflow.repository, repository) &&
        (String(id) === wanted || workflow.file === wanted),
    );
  }

  function listWorkflows(
    match: RegExpMatchArray,
    response: ServerResponse,
    searchParams: URLSearchParams,
  ) {
    const repository = repositoryOf(match);
    const entries = [...workflows.entries()].filter(([, workflow]) =>
      sameRepository(workflow.repository, repository),
    );
    sendJson(response, 200, {
      total_count: entries.length,
      workflows: paginate(
        entries.map(([id, workflow]) => workflowPayload(id, workflow)),
        searchParams,
      ),
    });
  }

  function listWorkflowRuns(
    match: RegExpMatchArray,
    response: ServerResponse,
    searchParams: URLSearchParams,
  ) {
    const found = findWorkflow(repositoryOf(match), match[3] ?? '');
    const runs =
      found === undefined
        ? []
        : [...workflowRuns.entries()]
            .filter(([, run]) => run.workflowId === found[0])
            .map(([id, run], index) =>
              workflowRunPayload({
                id,
                run,
                runNumber: index + 1,
                workflowId: found[0],
                workflow: found[1],
              }),
            )
            .reverse();
    sendJson(response, 200, {
      total_count: runs.length,
      workflow_runs: paginate(runs, searchParams),
    });
  }

  function getWorkflow(match: RegExpMatchArray, response: ServerResponse) {
    const found = findWorkflow(repositoryOf(match), match[3] ?? '');
    if (found === undefined) sendJson(response, 404, {message: 'Not Found'});
    else sendJson(response, 200, workflowPayload(found[0], found[1]));
  }

  return {
    handle(request, response, requestUrl) {
      if (request.method !== 'GET') return false;
      const {pathname, searchParams} = requestUrl;
      const listMatch = pathname.match(WORKFLOWS_PATH);
      if (listMatch !== null) listWorkflows(listMatch, response, searchParams);
      const runsMatch = pathname.match(WORKFLOW_RUNS_PATH);
      if (runsMatch !== null) listWorkflowRuns(runsMatch, response, searchParams);
      const workflowMatch = pathname.match(WORKFLOW_PATH);
      if (workflowMatch !== null) getWorkflow(workflowMatch, response);
      return listMatch !== null || runsMatch !== null || workflowMatch !== null;
    },
  };
}

import type {IncomingMessage, ServerResponse} from 'node:http';
import {paginate, sendJson} from './http.js';
import {sameRepository} from './pull-requests.js';

const WORKFLOWS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows$/u;
const WORKFLOW_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/]+)$/u;
const WORKFLOW_RUNS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/]+)\/runs$/u;
const RUN_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)$/u;
const RUN_JOBS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/jobs$/u;
const RUN_ARTIFACTS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/artifacts$/u;
const RUN_TIMING_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/timing$/u;
const RUN_LOGS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/logs$/u;
const JOB_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/jobs\/(\d+)$/u;
const JOB_LOGS_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/jobs\/(\d+)\/logs$/u;
const ARTIFACT_ARCHIVE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/actions\/artifacts\/(\d+)\/zip$/u;

const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00Z';
const FIXTURE_ACTOR_ID = 5_000_001;
const FIXTURE_JOB_DURATION_MS = 2000;

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
  /** The jobs of the run. Their ids follow the run id. A run without jobs has none. */
  jobs?: GithubWorkflowJobFixture[] | undefined;
  /** The artifacts the run uploaded. Their ids follow the run id. */
  artifacts?: GithubArtifactFixture[] | undefined;
}

export interface GithubWorkflowJobFixture {
  name: string;
  /** Defaults to the status of the run. */
  status?: 'queued' | 'in_progress' | 'completed' | undefined;
  /** Defaults to the conclusion of the run. */
  conclusion?: 'success' | 'failure' | 'cancelled' | undefined;
  /** Step names. Defaults to the steps every job has: set up, complete. */
  steps?: string[] | undefined;
}

export interface GithubArtifactFixture {
  name: string;
  sizeInBytes?: number | undefined;
  expired?: boolean | undefined;
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

// A job or artifact id sits under its run id, so a test needs to pick only the run ids.
const CHILDREN_PER_RUN = 100;

function childId(runId: number, index: number): number {
  return runId * CHILDREN_PER_RUN + index + 1;
}

function jobPayload({
  runId,
  index,
  job,
  run,
  repository,
}: {
  runId: number;
  index: number;
  job: GithubWorkflowJobFixture;
  run: GithubWorkflowRunFixture;
  repository: string;
}): Record<string, unknown> {
  const id = childId(runId, index);
  const status = job.status ?? run.status ?? 'completed';
  const conclusion =
    status === 'completed' ? (job.conclusion ?? run.conclusion ?? 'success') : null;
  const stepNames = job.steps ?? ['Set up job', 'Complete job'];
  return {
    id,
    run_id: runId,
    run_url: `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
    run_attempt: 1,
    node_id: `CR_${id}`,
    head_sha: run.sha,
    head_branch: run.branch ?? 'main',
    url: `https://api.github.com/repos/${repository}/actions/jobs/${id}`,
    html_url: `https://github.com/${repository}/actions/runs/${runId}/job/${id}`,
    status,
    conclusion,
    created_at: FIXTURE_TIMESTAMP,
    started_at: FIXTURE_TIMESTAMP,
    completed_at: status === 'completed' ? FIXTURE_TIMESTAMP : null,
    name: job.name,
    steps: stepNames.map((name, stepIndex) => ({
      name,
      status,
      conclusion,
      number: stepIndex + 1,
      started_at: FIXTURE_TIMESTAMP,
      completed_at: status === 'completed' ? FIXTURE_TIMESTAMP : null,
    })),
    labels: ['ubuntu-latest'],
    runner_name: 'GitHub Actions 1',
    runner_group_name: 'GitHub Actions',
  };
}

function artifactPayload({
  runId,
  index,
  artifact,
  run,
  repository,
}: {
  runId: number;
  index: number;
  artifact: GithubArtifactFixture;
  run: GithubWorkflowRunFixture;
  repository: string;
}): Record<string, unknown> {
  const id = childId(runId, index);
  return {
    id,
    node_id: `A_${id}`,
    name: artifact.name,
    size_in_bytes: artifact.sizeInBytes ?? 1024,
    url: `https://api.github.com/repos/${repository}/actions/artifacts/${id}`,
    archive_download_url: `https://api.github.com/repos/${repository}/actions/artifacts/${id}/zip`,
    expired: artifact.expired ?? false,
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    expires_at: '2099-01-01T00:00:00Z',
    workflow_run: {id: runId, head_branch: run.branch ?? 'main', head_sha: run.sha},
  };
}

/**
 * The workflow routes of the Actions API: the workflows of a repository, one workflow by id or
 * file name, the runs of a workflow, and one run with its jobs, artifacts, timing, and the
 * redirects to its logs. A workflow no test seeded has never run, so its run
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

  // The runs of a workflow, oldest first. A run's number is its position.
  function runsOf(workflowId: number) {
    return [...workflowRuns.entries()]
      .filter(([, run]) => run.workflowId === workflowId)
      .sort(([left], [right]) => left - right);
  }

  function findRun(repository: string, reference: string | undefined) {
    const runId = Number(reference);
    const run = workflowRuns.get(runId);
    const workflow = run === undefined ? undefined : workflows.get(run.workflowId);
    if (run === undefined || workflow === undefined) return undefined;
    if (!sameRepository(workflow.repository, repository)) return undefined;
    const runNumber = runsOf(run.workflowId).findIndex(([id]) => id === runId) + 1;
    return {runId, run, workflow, runNumber};
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
        : runsOf(found[0])
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

  function getRun(match: RegExpMatchArray, response: ServerResponse) {
    const found = findRun(repositoryOf(match), match[3]);
    if (found === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    sendJson(
      response,
      200,
      workflowRunPayload({
        id: found.runId,
        run: found.run,
        runNumber: found.runNumber,
        workflowId: found.run.workflowId,
        workflow: found.workflow,
      }),
    );
  }

  function listRunJobs(
    match: RegExpMatchArray,
    response: ServerResponse,
    searchParams: URLSearchParams,
  ) {
    const repository = repositoryOf(match);
    const found = findRun(repository, match[3]);
    if (found === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    const jobs = (found.run.jobs ?? []).map((job, index) =>
      jobPayload({runId: found.runId, index, job, run: found.run, repository}),
    );
    sendJson(response, 200, {total_count: jobs.length, jobs: paginate(jobs, searchParams)});
  }

  function listRunArtifacts(
    match: RegExpMatchArray,
    response: ServerResponse,
    searchParams: URLSearchParams,
  ) {
    const repository = repositoryOf(match);
    const found = findRun(repository, match[3]);
    if (found === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    const artifacts = (found.run.artifacts ?? []).map((artifact, index) =>
      artifactPayload({runId: found.runId, index, artifact, run: found.run, repository}),
    );
    sendJson(response, 200, {
      total_count: artifacts.length,
      artifacts: paginate(artifacts, searchParams),
    });
  }

  function getRunTiming(match: RegExpMatchArray, response: ServerResponse) {
    const found = findRun(repositoryOf(match), match[3]);
    if (found === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    const jobCount = found.run.jobs?.length ?? 0;
    sendJson(response, 200, {
      billable: {UBUNTU: {total_ms: jobCount * FIXTURE_JOB_DURATION_MS, jobs: jobCount}},
      run_duration_ms: jobCount * FIXTURE_JOB_DURATION_MS,
    });
  }

  // A job id is its run id times CHILDREN_PER_RUN plus its position, so the run is recoverable.
  function findJob(repository: string, reference: string | undefined) {
    const jobId = Number(reference);
    const runId = Math.floor((jobId - 1) / CHILDREN_PER_RUN);
    const index = (jobId - 1) % CHILDREN_PER_RUN;
    const found = findRun(repository, String(runId));
    const job = found?.run.jobs?.[index];
    return found === undefined || job === undefined ? undefined : {...found, jobId, index, job};
  }

  function getJob(match: RegExpMatchArray, response: ServerResponse) {
    const repository = repositoryOf(match);
    const found = findJob(repository, match[3]);
    if (found === undefined) {
      sendJson(response, 404, {message: 'Not Found'});
      return;
    }
    sendJson(
      response,
      200,
      jobPayload({
        runId: found.runId,
        index: found.index,
        job: found.job,
        run: found.run,
        repository,
      }),
    );
  }

  // GitHub answers a log or artifact download with a redirect to a short-lived archive.
  function redirectToArchive({
    response,
    requestUrl,
    path,
  }: {
    response: ServerResponse;
    requestUrl: URL;
    path: string;
  }) {
    response.writeHead(302, {location: new URL(path, requestUrl).toString()}).end();
  }

  function redirectRunLogs(match: RegExpMatchArray, response: ServerResponse, requestUrl: URL) {
    const found = findRun(repositoryOf(match), match[3]);
    if (found === undefined) sendJson(response, 404, {message: 'Not Found'});
    else redirectToArchive({response, requestUrl, path: `/download/runs/${found.runId}/logs.zip`});
  }

  function redirectJobLogs(match: RegExpMatchArray, response: ServerResponse, requestUrl: URL) {
    const found = findJob(repositoryOf(match), match[3]);
    if (found === undefined) sendJson(response, 404, {message: 'Not Found'});
    else redirectToArchive({response, requestUrl, path: `/download/jobs/${found.jobId}/logs.txt`});
  }

  function redirectArtifact(match: RegExpMatchArray, response: ServerResponse, requestUrl: URL) {
    const artifactId = Number(match[3]);
    const runId = Math.floor((artifactId - 1) / CHILDREN_PER_RUN);
    const found = findRun(repositoryOf(match), String(runId));
    const artifact = found?.run.artifacts?.[(artifactId - 1) % CHILDREN_PER_RUN];
    if (artifact === undefined) sendJson(response, 404, {message: 'Not Found'});
    else redirectToArchive({response, requestUrl, path: `/download/artifacts/${artifactId}.zip`});
  }

  function getWorkflow(match: RegExpMatchArray, response: ServerResponse) {
    const found = findWorkflow(repositoryOf(match), match[3] ?? '');
    if (found === undefined) sendJson(response, 404, {message: 'Not Found'});
    else sendJson(response, 200, workflowPayload(found[0], found[1]));
  }

  const ROUTES: Array<{
    path: RegExp;
    handle: (match: RegExpMatchArray, response: ServerResponse, requestUrl: URL) => void;
  }> = [
    {path: WORKFLOWS_PATH, handle: (m, r, u) => listWorkflows(m, r, u.searchParams)},
    {path: WORKFLOW_RUNS_PATH, handle: (m, r, u) => listWorkflowRuns(m, r, u.searchParams)},
    {path: WORKFLOW_PATH, handle: (m, r) => getWorkflow(m, r)},
    {path: RUN_PATH, handle: (m, r) => getRun(m, r)},
    {path: RUN_JOBS_PATH, handle: (m, r, u) => listRunJobs(m, r, u.searchParams)},
    {path: RUN_ARTIFACTS_PATH, handle: (m, r, u) => listRunArtifacts(m, r, u.searchParams)},
    {path: RUN_TIMING_PATH, handle: (m, r) => getRunTiming(m, r)},
    {path: RUN_LOGS_PATH, handle: redirectRunLogs},
    {path: JOB_PATH, handle: (m, r) => getJob(m, r)},
    {path: JOB_LOGS_PATH, handle: redirectJobLogs},
    {path: ARTIFACT_ARCHIVE_PATH, handle: redirectArtifact},
  ];

  return {
    handle(request, response, requestUrl) {
      if (request.method !== 'GET') return false;
      for (const route of ROUTES) {
        const match = requestUrl.pathname.match(route.path);
        if (match === null) continue;
        route.handle(match, response, requestUrl);
        return true;
      }
      return false;
    },
  };
}

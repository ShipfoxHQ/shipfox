import type {WorkflowModel} from '@shipfox/api-definitions';
import {createProject} from '@shipfox/api-projects';
import {
  type E2eWorkflowRunPageFixtureResponseDto,
  e2eCreateWorkflowRunPageFixtureBodySchema,
  e2eWorkflowRunPageFixtureResponseSchema,
} from '@shipfox/api-workflows-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {nextStepForJob, recordStepResult} from '#core/job-execution.js';
import {
  createWorkflowRun,
  getJobsByRunId,
  getWorkflowRunById,
  listWorkflowRuns,
} from '#db/index.js';
import {toRunDetailDto} from '#presentation/dto/run-detail.js';
import {toRunDto} from '#presentation/dto/workflow-run.js';
import {setJobStatus, setRunStatus} from '#temporal/activities/orchestration-activities.js';

type Scenario = 'succeeded' | 'failed' | 'running';
type TerminalScenario = Exclude<Scenario, 'running'>;

const scenarioNames = {
  succeeded: 'Deploy pipeline succeeded',
  failed: 'Deploy pipeline failed',
  running: 'Deploy pipeline running',
} satisfies Record<Scenario, string>;

function model(name: string): WorkflowModel {
  return {
    kind: 'workflow',
    name,
    triggers: [
      {
        id: 'manual-run',
        sourceName: 'manual_run',
        source: 'manual',
        event: 'fire',
      },
    ],
    jobs: [
      {
        id: 'build',
        sourceName: 'Build',
        runner: ['ubuntu-latest'],
        dependencies: [],
        steps: [
          {
            id: 'build-install',
            sourceName: 'Install dependencies',
            kind: 'run',
            command: {kind: 'shell', value: 'pnpm install --frozen-lockfile'},
          },
          {
            id: 'build-compile',
            sourceName: 'Compile application',
            kind: 'run',
            command: {kind: 'shell', value: 'turbo build --filter=@shipfox/client...'},
          },
        ],
      },
      {
        id: 'test',
        sourceName: 'Test',
        runner: ['ubuntu-latest'],
        dependencies: ['build'],
        steps: [
          {
            id: 'test-unit',
            sourceName: 'Unit tests',
            kind: 'run',
            command: {kind: 'shell', value: 'turbo test --filter=@shipfox/client...'},
          },
          {
            id: 'test-e2e',
            sourceName: 'Browser smoke',
            kind: 'run',
            command: {kind: 'shell', value: 'turbo test:e2e --filter=@shipfox/e2e-client-projects'},
          },
        ],
      },
      {
        id: 'deploy',
        sourceName: 'Deploy',
        runner: ['ubuntu-latest'],
        dependencies: ['test'],
        steps: [
          {
            id: 'deploy-release',
            sourceName: 'Promote release',
            kind: 'run',
            command: {kind: 'shell', value: 'shipfox deploy production'},
          },
        ],
      },
    ],
    dependencies: [
      {from: 'build', to: 'test'},
      {from: 'test', to: 'deploy'},
    ],
  };
}

async function startRun(params: {workspaceId: string; projectId: string; scenario: Scenario}) {
  const run = await createWorkflowRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: crypto.randomUUID(),
    name: scenarioNames[params.scenario],
    model: model(scenarioNames[params.scenario]),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
    inputs: {environment: 'production', ref: 'main'},
  });

  const {newVersion} = await setRunStatus({runId: run.id, status: 'running', version: 1});
  const running = await getWorkflowRunById(run.id);
  if (!running) throw new Error(`Run not found: ${run.id}`);
  if (running.version !== newVersion) {
    throw new Error(`Run ${run.id} version mismatch after status update`);
  }
  return running;
}

async function startJob(jobId: string): Promise<number> {
  const {newVersion} = await setJobStatus({jobId, status: 'running', version: 1});
  return newVersion;
}

async function finishJob(params: {
  jobId: string;
  runningVersion: number;
  status: TerminalScenario;
}): Promise<void> {
  await setJobStatus({
    jobId: params.jobId,
    status: params.status,
    version: params.runningVersion,
  });
}

async function finishNextStep(params: {
  jobId: string;
  status: TerminalScenario;
  exitCode: number;
  error?: Record<string, unknown> | undefined;
}): Promise<void> {
  const next = await nextStepForJob(params.jobId);
  if (next.kind !== 'step') {
    throw new Error(`Expected next step for job ${params.jobId}, got done`);
  }

  await recordStepResult({
    jobId: params.jobId,
    stepId: next.step.id,
    status: params.status,
    attempt: next.step.currentAttempt,
    exitCode: params.exitCode,
    error: params.error ?? null,
    output: params.status === 'succeeded' ? {summary: `${next.step.name ?? 'Step'} passed`} : null,
  });
}

async function finishJobSteps(jobId: string): Promise<void> {
  while (true) {
    const next = await nextStepForJob(jobId);
    if (next.kind === 'done') return;
    await recordStepResult({
      jobId,
      stepId: next.step.id,
      status: 'succeeded',
      attempt: next.step.currentAttempt,
      exitCode: 0,
      output: {summary: `${next.step.name ?? 'Step'} passed`},
    });
  }
}

async function createSucceededRun(params: {workspaceId: string; projectId: string}) {
  const run = await startRun({...params, scenario: 'succeeded'});
  const jobs = await getJobsByRunId(run.id);

  for (const job of jobs) {
    const runningVersion = await startJob(job.id);
    await finishJobSteps(job.id);
    await finishJob({jobId: job.id, runningVersion, status: 'succeeded'});
  }

  const {newVersion} = await setRunStatus({
    runId: run.id,
    status: 'succeeded',
    version: run.version,
  });
  const finished = await getWorkflowRunById(run.id);
  if (!finished) throw new Error(`Run not found: ${run.id}`);
  if (finished.version !== newVersion) {
    throw new Error(`Run ${run.id} version mismatch after status update`);
  }
  return await toRunDetailDto(finished);
}

async function createFailedRun(params: {workspaceId: string; projectId: string}) {
  const run = await startRun({...params, scenario: 'failed'});
  const [build, test, deploy] = await getJobsByRunId(run.id);
  if (!build || !test || !deploy) throw new Error('Expected build, test, and deploy jobs');

  const buildVersion = await startJob(build.id);
  await finishJobSteps(build.id);
  await finishJob({jobId: build.id, runningVersion: buildVersion, status: 'succeeded'});

  const testVersion = await startJob(test.id);
  await finishNextStep({jobId: test.id, status: 'succeeded', exitCode: 0});
  await finishNextStep({jobId: test.id, status: 'succeeded', exitCode: 0});
  await finishNextStep({
    jobId: test.id,
    status: 'failed',
    exitCode: 1,
    error: {message: 'Browser smoke failed on checkout summary', exitCode: 1},
  });
  await finishJob({jobId: test.id, runningVersion: testVersion, status: 'failed'});
  await setJobStatus({jobId: deploy.id, status: 'cancelled', version: 1});

  const {newVersion} = await setRunStatus({
    runId: run.id,
    status: 'failed',
    version: run.version,
  });
  const finished = await getWorkflowRunById(run.id);
  if (!finished) throw new Error(`Run not found: ${run.id}`);
  if (finished.version !== newVersion) {
    throw new Error(`Run ${run.id} version mismatch after status update`);
  }
  return await toRunDetailDto(finished);
}

async function createRunningRun(params: {workspaceId: string; projectId: string}) {
  const run = await startRun({...params, scenario: 'running'});
  const [build, test] = await getJobsByRunId(run.id);
  if (!build || !test) throw new Error('Expected build and test jobs');

  const buildVersion = await startJob(build.id);
  await finishJobSteps(build.id);
  await finishJob({jobId: build.id, runningVersion: buildVersion, status: 'succeeded'});

  await startJob(test.id);
  await finishNextStep({jobId: test.id, status: 'succeeded', exitCode: 0});
  await dispatchInFlightStep(test.id);

  return await toRunDetailDto(run);
}

async function dispatchInFlightStep(jobId: string): Promise<void> {
  const runningStep = await nextStepForJob(jobId);
  if (runningStep.kind !== 'step') {
    throw new Error(`Expected running step for job ${jobId}, got done`);
  }
}

async function createWorkflowRunPageFixture(params: {
  workspaceId: string;
  projectName?: string | undefined;
}): Promise<E2eWorkflowRunPageFixtureResponseDto> {
  const project = await createProject({
    workspaceId: params.workspaceId,
    sourceConnectionId: crypto.randomUUID(),
    sourceExternalRepositoryId: `e2e-workflow-run-page-${crypto.randomUUID()}`,
    name: params.projectName ?? 'Workflow Run Page Fixture',
  });

  const succeeded = await createSucceededRun({
    workspaceId: params.workspaceId,
    projectId: project.id,
  });
  const failed = await createFailedRun({workspaceId: params.workspaceId, projectId: project.id});
  const running = await createRunningRun({workspaceId: params.workspaceId, projectId: project.id});
  const listed = await listWorkflowRuns({projectId: project.id, limit: 50, includeTotal: true});

  return e2eWorkflowRunPageFixtureResponseSchema.parse({
    project: {
      id: project.id,
      workspace_id: project.workspaceId,
      name: project.name,
    },
    run_list: {
      runs: listed.runs.map(toRunDto),
      next_cursor: null,
      filtered_total_count: listed.filteredTotalCount,
    },
    runs: {
      succeeded,
      failed,
      running,
    },
    deferred: {
      gated_restart: 'typed-gate-restart-contract-not-on-main',
    },
  });
}

export const createE2eWorkflowRunPageFixtureRoute = defineRoute({
  method: 'POST',
  path: '/run-page-fixture',
  description: 'Create real workflow run page fixture data for E2E tests.',
  schema: {
    body: e2eCreateWorkflowRunPageFixtureBodySchema,
    response: {
      201: e2eWorkflowRunPageFixtureResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const fixture = await createWorkflowRunPageFixture({
      workspaceId: request.body.workspace_id,
      projectName: request.body.project_name,
    });

    reply.status(201);
    return fixture;
  },
});

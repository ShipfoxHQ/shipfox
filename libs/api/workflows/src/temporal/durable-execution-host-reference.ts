import type {RuntimeCommand} from '#core/runtime/runtime-command.js';

export type DurableExecutionHostCommandAdapterReference = Readonly<{
  commandType: RuntimeCommand['type'];
  temporalOperation: string;
  owner: string;
  persistenceSideEffect: string;
  currentLimitation: string;
}>;

export type DurableExecutionHostWorkflowReference = Readonly<{
  name: string;
  owner: string;
  role: string;
}>;

export type DurableExecutionHostActivityReference = Readonly<{
  name: string;
  owner: string;
  sideEffect: string;
}>;

const durableExecutionHostCommandAdapterReferenceByType: Record<
  RuntimeCommand['type'],
  Omit<DurableExecutionHostCommandAdapterReference, 'commandType'>
> = {
  start_job: {
    temporalOperation:
      'Collect into the current batch and execute one child `jobOrchestration` workflow per job.',
    owner: 'libs/api/workflows/src/temporal/workflows/run-orchestration.ts#applyRuntimeCommands',
    persistenceSideEffect:
      '`jobOrchestration` marks the job `running`, enqueues the runner job, then persists the terminal job status.',
    currentLimitation:
      'The parent awaits the emitted start-job batch before reconciling downstream runtime commands.',
  },
  cancel_job: {
    temporalOperation: 'Call `setJobStatus` directly from `runOrchestration`.',
    owner: 'libs/api/workflows/src/temporal/workflows/run-orchestration.ts#applyRuntimeCommands',
    persistenceSideEffect:
      'Updates the durable job status to `cancelled` with optimistic versioning.',
    currentLimitation:
      'Cancellation is status-only for pending jobs; active runner cancellation remains outside the PR1 runtime kernel.',
  },
  complete_run: {
    temporalOperation: 'Call `setRunStatus` directly from `runOrchestration`.',
    owner: 'libs/api/workflows/src/temporal/workflows/run-orchestration.ts#applyRuntimeCommands',
    persistenceSideEffect:
      'Updates the durable workflow-run status to the runtime command status with optimistic versioning.',
    currentLimitation:
      'The runtime command only carries final status; run summaries and snapshots remain outside PR1.',
  },
};

export const durableExecutionHostCommandAdapterReference: readonly DurableExecutionHostCommandAdapterReference[] =
  Object.entries(durableExecutionHostCommandAdapterReferenceByType).map(
    ([commandType, reference]) => ({
      commandType: commandType as RuntimeCommand['type'],
      ...reference,
    }),
  );

export const durableExecutionHostWorkflowReference: readonly DurableExecutionHostWorkflowReference[] =
  [
    {
      name: 'runOrchestration',
      owner: 'libs/api/workflows/src/temporal/workflows/run-orchestration.ts',
      role: 'Loads the durable DAG, initializes runtime state, feeds runtime events to the pure kernel, and adapts emitted commands.',
    },
    {
      name: 'jobOrchestration',
      owner: 'libs/api/workflows/src/temporal/workflows/job-orchestration.ts',
      role: 'Executes one durable job by marking it running, enqueueing runner work, waiting for completion or timeout, and returning terminal status.',
    },
  ];

export const durableExecutionHostActivityReference: readonly DurableExecutionHostActivityReference[] =
  [
    {
      name: 'loadRunDag',
      owner: 'libs/api/workflows/src/temporal/activities/orchestration-activities.ts',
      sideEffect: 'Reads workflow-run, job, and step rows used to initialize runtime state.',
    },
    {
      name: 'setRunStatus',
      owner: 'libs/api/workflows/src/temporal/activities/orchestration-activities.ts',
      sideEffect: 'Updates workflow-run status with optimistic versioning.',
    },
    {
      name: 'setJobStatus',
      owner: 'libs/api/workflows/src/temporal/activities/orchestration-activities.ts',
      sideEffect: 'Updates job status with optimistic versioning.',
    },
    {
      name: 'enqueueJobForRunner',
      owner: 'libs/api/workflows/src/temporal/activities/orchestration-activities.ts',
      sideEffect: 'Publishes runner work through the runners package.',
    },
    {
      name: 'applyStepResultsActivity',
      owner: 'libs/api/workflows/src/temporal/activities/orchestration-activities.ts',
      sideEffect: 'Maps runner completion DTOs to domain step results and persists them.',
    },
    {
      name: 'failJobAsTimedOutActivity',
      owner: 'libs/api/workflows/src/temporal/activities/orchestration-activities.ts',
      sideEffect: 'Atomically marks a timed-out job failed and writes the timeout outbox event.',
    },
    {
      name: 'bulkSetStepStatuses',
      owner: 'libs/api/workflows/src/temporal/activities/orchestration-activities.ts',
      sideEffect: 'Bulk-updates step statuses after timeout failure.',
    },
  ];

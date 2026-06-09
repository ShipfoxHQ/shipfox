import type {WorkflowModel} from '@shipfox/api-definitions';

interface TestWorkflowStep {
  readonly name?: string | undefined;
  readonly run: string;
}

interface TestWorkflowJob {
  readonly needs?: string | readonly string[] | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly steps: readonly TestWorkflowStep[];
}

interface TestWorkflowModelInput {
  readonly name?: string | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly jobs?: Readonly<Record<string, TestWorkflowJob>> | undefined;
}

export function workflowModel(input: TestWorkflowModelInput = {}): WorkflowModel {
  const jobs = input.jobs ?? {
    build: {
      steps: [{run: 'echo hello'}],
    },
  };
  const modelJobs = Object.entries(jobs).map(([sourceName, job]) => {
    const jobId = stableId(sourceName);
    return {
      id: jobId,
      sourceName,
      runner: normalizeStringArray(job.runner ?? input.runner),
      dependencies: normalizeStringArray(job.needs).map(stableId),
      steps: job.steps.map((step, stepIndex) => ({
        id:
          step.name === undefined
            ? `${jobId}-step-${stepIndex + 1}`
            : `${jobId}-${stableId(step.name)}`,
        ...(step.name === undefined ? {} : {sourceName: step.name}),
        kind: 'run' as const,
        command: {kind: 'shell' as const, value: step.run},
      })),
    };
  });

  return {
    kind: 'workflow',
    name: input.name ?? 'Test Workflow',
    triggers: [],
    jobs: modelJobs,
    dependencies: modelJobs.flatMap((job) =>
      job.dependencies.map((dependency) => ({from: dependency, to: job.id})),
    ),
  };
}

function normalizeStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function stableId(sourceName: string): string {
  const id = sourceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id.length === 0 ? 'unnamed' : id;
}

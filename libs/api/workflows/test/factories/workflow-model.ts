import type {WorkflowModel} from '@shipfox/api-definitions';

type ModelStep = WorkflowModel['jobs'][number]['steps'][number];
type AgentThinking = Extract<ModelStep, {kind: 'agent'}>['thinking'];

interface TestWorkflowStepBase {
  readonly name?: string | undefined;
  readonly sourceLocation?: WorkflowModel['jobs'][number]['steps'][number]['sourceLocation'];
  readonly gate?: WorkflowModel['jobs'][number]['steps'][number]['gate'] | undefined;
}

interface TestRunStep extends TestWorkflowStepBase {
  readonly run: string;
  readonly env?: WorkflowModel['env'] | undefined;
}

interface TestAgentStep extends TestWorkflowStepBase {
  readonly model: string;
  readonly provider: string;
  readonly prompt: string;
  readonly thinking: AgentThinking;
}

type TestWorkflowStep = TestRunStep | TestAgentStep;

interface TestWorkflowJob {
  readonly needs?: string | readonly string[] | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly steps: readonly TestWorkflowStep[];
}

interface TestWorkflowModelInput {
  readonly name?: string | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
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
      ...optionalEnv(job.env),
      dependencies: normalizeStringArray(job.needs).map(stableId),
      steps: job.steps.map((step, stepIndex) => normalizeStep(step, jobId, stepIndex)),
    };
  });

  return {
    kind: 'workflow',
    name: input.name ?? 'Test Workflow',
    ...optionalEnv(input.env),
    triggers: [],
    jobs: modelJobs,
    dependencies: modelJobs.flatMap((job) =>
      job.dependencies.map((dependency) => ({from: dependency, to: job.id})),
    ),
  };
}

function normalizeStep(step: TestWorkflowStep, jobId: string, stepIndex: number): ModelStep {
  const base = stepBase(step, jobId, stepIndex);
  return 'run' in step
    ? {
        ...base,
        kind: 'run',
        command: {kind: 'shell', value: step.run},
        ...optionalEnv(step.env),
      }
    : {
        ...base,
        kind: 'agent',
        model: step.model,
        provider: step.provider,
        thinking: step.thinking,
        prompt: step.prompt,
      };
}

function stepBase(step: TestWorkflowStep, jobId: string, stepIndex: number) {
  return {
    id:
      step.name === undefined
        ? `${jobId}-step-${stepIndex + 1}`
        : `${jobId}-${stableId(step.name)}`,
    ...(step.name === undefined ? {} : {sourceName: step.name}),
    ...(step.sourceLocation === undefined ? {} : {sourceLocation: step.sourceLocation}),
    ...(step.gate === undefined ? {} : {gate: step.gate}),
  };
}

function normalizeStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function optionalEnv(
  env: WorkflowModel['env'] | undefined,
): {env: NonNullable<WorkflowModel['env']>} | Record<string, never> {
  if (env === undefined || Object.keys(env).length === 0) return {};
  return {env};
}

function stableId(sourceName: string): string {
  const id = sourceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id.length === 0 ? 'unnamed' : id;
}

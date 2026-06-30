import type {WorkflowModel} from '@shipfox/api-definitions';
import {parseWorkflowTemplate, type WorkflowTemplateSegment} from '@shipfox/expression';

type ModelStep = WorkflowModel['jobs'][number]['steps'][number];
type AgentThinking = Extract<ModelStep, {kind: 'agent'}>['thinking'];
type WorkflowEnvTemplates = NonNullable<NonNullable<WorkflowModel['templates']>['env']>;

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
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly prompt: string;
  readonly thinking?: AgentThinking | undefined;
}

type TestWorkflowStep = TestRunStep | TestAgentStep;

const DEFAULT_RUNNER_LABELS = ['ubuntu-latest'] as const;

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
      runner: normalizeStringArray(job.runner ?? input.runner ?? DEFAULT_RUNNER_LABELS),
      ...optionalScopedEnv(job.env),
      dependencies: normalizeStringArray(job.needs).map(stableId),
      steps: job.steps.map((step, stepIndex) => normalizeStep(step, jobId, stepIndex)),
    };
  });

  return {
    kind: 'workflow',
    name: input.name ?? 'Test Workflow',
    ...optionalScopedEnv(input.env),
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
        ...optionalRunTemplates(step),
        ...optionalStepEnv(step.env),
      }
    : {
        ...base,
        kind: 'agent',
        ...(step.model === undefined ? {} : {model: step.model}),
        ...(step.provider === undefined ? {} : {provider: step.provider}),
        ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
        prompt: step.prompt,
        ...optionalAgentTemplates(step),
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

function optionalScopedEnv(
  env: WorkflowModel['env'] | undefined,
):
  | {env: NonNullable<WorkflowModel['env']>; templates: {env: WorkflowEnvTemplates}}
  | {env: NonNullable<WorkflowModel['env']>}
  | Record<string, never> {
  if (env === undefined || Object.keys(env).length === 0) return {};
  const templates = envTemplates(env);
  return templates === undefined ? {env} : {env, templates: {env: templates}};
}

function optionalStepEnv(
  env: WorkflowModel['env'] | undefined,
): {env: NonNullable<WorkflowModel['env']>} | Record<string, never> {
  if (env === undefined || Object.keys(env).length === 0) return {};
  return {env};
}

function optionalRunTemplates(step: TestRunStep) {
  const command = fieldTemplate(step.run);
  const name = step.name === undefined ? undefined : fieldTemplate(step.name);
  const env = envTemplates(step.env);
  if (command === undefined && name === undefined && env === undefined) return {};
  return {
    templates: {
      ...(command === undefined ? {} : {command}),
      ...(name === undefined ? {} : {name}),
      ...(env === undefined ? {} : {env}),
    },
  };
}

function optionalAgentTemplates(step: TestAgentStep) {
  const prompt = fieldTemplate(step.prompt);
  const model = step.model === undefined ? undefined : fieldTemplate(step.model);
  const provider = step.provider === undefined ? undefined : fieldTemplate(step.provider);
  const name = step.name === undefined ? undefined : fieldTemplate(step.name);
  if (prompt === undefined && model === undefined && provider === undefined && name === undefined) {
    return {};
  }
  return {
    templates: {
      ...(prompt === undefined ? {} : {prompt}),
      ...(model === undefined ? {} : {model}),
      ...(provider === undefined ? {} : {provider}),
      ...(name === undefined ? {} : {name}),
    },
  };
}

function envTemplates(env: WorkflowModel['env'] | undefined): WorkflowEnvTemplates | undefined {
  if (env === undefined) return undefined;

  const templates = Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => {
      const template = fieldTemplate(value);
      return template === undefined ? [] : [[key, template]];
    }),
  );

  return Object.keys(templates).length === 0 ? undefined : templates;
}

function fieldTemplate(source: string): readonly WorkflowTemplateSegment[] | undefined {
  const segments = parseWorkflowTemplate(source);
  return segments.some((segment) => segment.kind === 'expr') ? segments : undefined;
}

function stableId(sourceName: string): string {
  const id = sourceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id.length === 0 ? 'unnamed' : id;
}

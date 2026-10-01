import type {AgentConfigInvalidReason} from '@shipfox/api-agent-dto';
import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {RunIssue} from '@shipfox/api-workflows-dto/inter-module';
import {shouldFillAtSite} from '@shipfox/expression';
import type {AgentDefaultsResolver, ResolvedAgentDefaults} from './agent-defaults.js';
import {AgentConfigUnresolvableError} from './errors.js';
import {capLocations} from './run-readiness.js';
import {completeAgentDefaults} from './step-config/agent.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelAgentStep = Extract<WorkflowModelJob['steps'][number], {kind: 'agent'}>;
type RunIssueLocation = RunIssue['locations'][number];
type AgentConfigIssue = Extract<RunIssue, {kind: 'agent-config-invalid'}>;

interface InvalidAgentStep {
  readonly effect: RunIssue['effect'];
  readonly reason: AgentConfigInvalidReason;
  readonly model: string | undefined;
  readonly provider: string | undefined;
  readonly location: RunIssueLocation;
}

/**
 * Report the agent steps whose static configuration the agent module would refuse. A step is
 * checked only when `model`, `provider` and `thinking` are each authored literally or left out,
 * which falls back to the workspace defaults. A templated value skips the step: readiness has
 * no run, trigger or execution to resolve it against.
 *
 * The effect follows from when the server validates the step, not from the issue:
 *
 * - A listening job's steps are materialized when an execution is created, so a refusal
 *   fails that execution.
 * - A normal job's steps are validated by `createWorkflowRun`, which refuses the start.
 *   `resolveAgentStepConfig` defers the validation to dispatch when a field it reads is
 *   still residual after run creation, and a refusal then fails the job. The only such field
 *   a static step can have is its session key.
 */
export async function checkAgentConfigReadiness(params: {
  readonly model: WorkflowModel;
  readonly definitionId: string;
  readonly resolveAgentDefaults: AgentDefaultsResolver;
}): Promise<RunIssue[]> {
  const invalid: InvalidAgentStep[] = [];
  for (const job of params.model.jobs) {
    invalid.push(...(await invalidStepsOf(job, params)));
  }

  return groupInvalidSteps(invalid);
}

async function invalidStepsOf(
  job: WorkflowModelJob,
  params: {readonly definitionId: string; readonly resolveAgentDefaults: AgentDefaultsResolver},
): Promise<InvalidAgentStep[]> {
  const invalid: InvalidAgentStep[] = [];
  for (const [index, step] of job.steps.entries()) {
    if (step.kind !== 'agent' || hasTemplatedConfig(step)) continue;

    const refusal = await refusalFor(step, params);
    if (refusal === undefined) continue;
    invalid.push({
      ...refusal,
      effect: effectFor(job, step),
      location: {
        jobKey: job.key,
        step: {
          ...(step.key === undefined ? {} : {key: step.key}),
          ...(step.name === undefined ? {} : {name: step.name}),
          index: index + 1,
        },
        field: locationField(refusal.reason),
      },
    });
  }
  return invalid;
}

/**
 * Wrap a resolver so one readiness request asks the agent module once per distinct
 * configuration. Steps without settings of their own all share the workspace defaults.
 */
export function cacheAgentDefaults(resolve: AgentDefaultsResolver): AgentDefaultsResolver {
  const cache = new Map<string, Promise<ResolvedAgentDefaults>>();
  return (input) => {
    const key = JSON.stringify([input.harness, input.provider, input.model, input.thinking]);
    const cached =
      cache.get(key) ?? new Promise<ResolvedAgentDefaults>((done) => done(resolve(input)));
    cache.set(key, cached);
    return cached;
  };
}

function hasTemplatedConfig(step: WorkflowModelAgentStep): boolean {
  return (
    step.templates?.model !== undefined ||
    step.templates?.provider !== undefined ||
    step.templates?.thinking !== undefined
  );
}

async function refusalFor(
  step: WorkflowModelAgentStep,
  params: {readonly definitionId: string; readonly resolveAgentDefaults: AgentDefaultsResolver},
): Promise<
  | {
      readonly reason: AgentConfigInvalidReason;
      readonly model: string | undefined;
      readonly provider: string | undefined;
    }
  | undefined
> {
  try {
    await completeAgentDefaults({
      harness: step.harness,
      provider: step.provider,
      model: step.model,
      thinking: step.thinking,
      resolveAgentDefaults: params.resolveAgentDefaults,
      definitionId: params.definitionId,
    });
    return undefined;
  } catch (error) {
    if (!(error instanceof AgentConfigUnresolvableError) || error.reason === undefined) {
      throw error;
    }
    return {reason: error.reason, model: error.model, provider: error.provider};
  }
}

function effectFor(job: WorkflowModelJob, step: WorkflowModelAgentStep): RunIssue['effect'] {
  if (job.mode === 'listening') return 'fails-job';
  return sessionKeyIsDeferred(step) ? 'fails-job' : 'blocks-start';
}

function sessionKeyIsDeferred(step: WorkflowModelAgentStep): boolean {
  return (
    step.session?.key.some(
      (segment) =>
        segment.kind !== 'literal' && !shouldFillAtSite(segment.fillTarget, 'run-creation'),
    ) ?? false
  );
}

/** The authored field a refusal points at. */
function locationField(reason: AgentConfigInvalidReason): RunIssueLocation['field'] {
  switch (reason) {
    case 'model-unknown':
      return 'agent.model';
    case 'thinking-unsupported':
      return 'agent.thinking';
    case 'provider-unsupported':
    case 'harness-unsupported':
    case 'workspace-providers-disabled':
      return 'agent.provider';
  }
}

/** One issue per cause and effect, listing each step it applies to. */
function groupInvalidSteps(invalid: readonly InvalidAgentStep[]): AgentConfigIssue[] {
  const groups = new Map<
    string,
    {readonly step: InvalidAgentStep; readonly locations: RunIssueLocation[]}
  >();
  for (const step of invalid) {
    const key = JSON.stringify([step.effect, step.reason, step.model, step.provider]);
    const group = groups.get(key) ?? {step, locations: []};
    group.locations.push(step.location);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map(({step, locations}) => ({
      kind: 'agent-config-invalid' as const,
      reason: step.reason,
      ...(step.model === undefined ? {} : {model: step.model}),
      ...(step.provider === undefined ? {} : {provider: step.provider}),
      ...capLocations(locations),
      effect: step.effect,
    }))
    .sort((left, right) => effectRank(left.effect) - effectRank(right.effect));
}

/** An issue that blocks the start sorts first. */
function effectRank(effect: RunIssue['effect']): number {
  return effect === 'blocks-start' ? 0 : 1;
}

import {capTraceEntries} from '@shipfox/expression';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {PersistedEvaluationTraceEntry, Step} from '#core/entities/step.js';
import {completeAgentConfig} from './agent.js';
import {completeRunDispatchConfig} from './run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export async function completeStepDispatchConfig(params: {
  readonly step: Step;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
}): Promise<{
  readonly config: Record<string, unknown>;
  readonly trace: readonly PersistedEvaluationTraceEntry[];
}> {
  const plan = params.step.configPlan;
  if (plan === null) return {config: params.step.config, trace: []};

  const config = {...params.step.config};
  delete config.secret_bindings;
  const trace: PersistedEvaluationTraceEntry[] = [...(plan.trace ?? [])];
  completeRunDispatchConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  await completeAgentConfig({
    config,
    plan,
    context: params.context,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
    trace,
  });

  return {config, trace: capTraceEntries(trace)};
}

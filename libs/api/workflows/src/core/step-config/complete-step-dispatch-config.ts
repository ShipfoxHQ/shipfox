import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {Step} from '#core/entities/step.js';
import {completeAgentConfig} from './agent.js';
import {completeRunDispatchConfig} from './run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export function completeStepDispatchConfig(params: {
  readonly step: Step;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults: AgentDefaultsResolver;
  readonly definitionId: string;
}): Record<string, unknown> {
  const plan = params.step.configPlan;
  if (plan === null) return params.step.config;

  const config = {...params.step.config};
  delete config.secret_bindings;
  completeRunDispatchConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
  });
  completeAgentConfig({
    config,
    plan,
    context: params.context,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
  });

  return config;
}

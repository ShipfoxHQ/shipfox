import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {WorkflowEnvTemplates, WorkflowModel} from '@shipfox/api-definitions';
import type {AvailabilitySite, WorkflowExpressionEvaluationContext} from '@shipfox/expression';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {resolveAgentStepConfig} from './agent.js';
import {
  freezeStepField,
  type StepConfigField,
  type WorkflowStepTemplateDiagnostic,
} from './fields.js';
import {resolveRunStepConfig, type StepConfigMode} from './run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelRunStep = Extract<WorkflowModelStep, {kind: 'run'}>;
type WorkflowModelAgentStep = Extract<WorkflowModelStep, {kind: 'agent'}>;

export type {StepConfigField, WorkflowStepTemplateDiagnostic};

export interface ResolvedStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly authoredConfig: Record<string, unknown> | null;
  readonly name?: string;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
}

export interface ResolveStepConfigParams {
  readonly step: WorkflowModelStep;
  readonly workflowEnv: WorkflowModel['env'];
  readonly workflowEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly jobEnv: WorkflowModelJob['env'];
  readonly jobEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly resolveAgentDefaults: AgentDefaultsResolver;
  readonly definitionId: string;
}

type BuildStepConfigParams = ResolveStepConfigParams & {readonly mode: StepConfigMode};

interface BuiltStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly hasTemplates: boolean;
}

export function resolveStepConfig(params: ResolveStepConfigParams): ResolvedStepConfig {
  const context = evaluationContext(params);
  const effective = buildStepConfig({...params, context, mode: 'effective'});
  const authoredConfig = effective.hasTemplates
    ? buildStepConfig({...params, context, mode: 'authored'}).config
    : null;
  const name = resolveStepName(params.step, context, params.definitionId);

  return {
    config: effective.config,
    configPlan: effective.configPlan,
    authoredConfig,
    ...(name.value === undefined || name.value === '' ? {} : {name: name.value}),
    diagnostics: [...effective.diagnostics, ...name.diagnostics],
  };
}

function buildStepConfig(
  params: Omit<BuildStepConfigParams, 'context'> & {readonly context: WorkflowEvaluationContext},
): BuiltStepConfig {
  const gate = gateConfigForStep(params.step);
  const runStep = runStepOrNull(params.step);
  const isRunStep = runStep !== null;

  if (isRunStep) {
    const run = resolveRunStepConfig({...params, step: runStep});
    return {
      config: {...run.config, ...gate},
      configPlan: run.configPlan,
      diagnostics: run.diagnostics,
      hasTemplates: run.hasTemplates,
    };
  }

  const agentStep = agentStepOrNull(params.step);
  if (agentStep === null) throw new Error(`Unsupported workflow step kind: ${params.step.kind}`);

  const agent = resolveAgentStepConfig({...params, step: agentStep});
  return {
    config: {...agent.config, ...gate},
    configPlan: agent.configPlan,
    diagnostics: agent.diagnostics,
    hasTemplates: agent.hasTemplates,
  };
}

function evaluationContext(params: {
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
}): WorkflowEvaluationContext {
  return {site: params.site, values: params.context};
}

function runStepOrNull(step: WorkflowModelStep): WorkflowModelRunStep | null {
  const isRunStep = step.kind === 'run';
  return isRunStep ? step : null;
}

function agentStepOrNull(step: WorkflowModelStep): WorkflowModelAgentStep | null {
  const isAgentStep = step.kind === 'agent';
  return isAgentStep ? step : null;
}

function gateConfigForStep(step: WorkflowModelStep): Record<string, unknown> {
  const hasGate = step.gate !== undefined;
  return hasGate ? {gate: stepGateConfig(step.gate)} : {};
}

function resolveStepName(
  step: WorkflowModelStep,
  context: WorkflowEvaluationContext,
  definitionId: string,
): {
  readonly value: string | undefined;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
} {
  const hasName = step.name !== undefined;
  if (!hasName) return {value: undefined, diagnostics: []};

  const hasNameTemplate = step.templates?.name !== undefined;
  if (!hasNameTemplate) return {value: step.name, diagnostics: []};

  const resolved = freezeStepField({
    field: 'step.name',
    template: {segments: step.templates.name},
    context,
    definitionId,
    errorField: 'step.name',
  });
  return {
    value: resolved.value,
    diagnostics: resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: 'step.name'})),
  };
}

function stepGateConfig(gate: NonNullable<WorkflowModelStep['gate']>): Record<string, unknown> {
  const hasSuccess = gate.success !== undefined;
  const hasOnFailure = gate.onFailure !== undefined;
  const hasOnFailureFeedback = gate.onFailure?.feedback !== undefined;

  return {
    ...(hasSuccess
      ? {
          success: {
            language: gate.success.language,
            check: gate.success.check,
            source: gate.success.source,
          },
        }
      : {}),
    ...(hasOnFailure
      ? {
          on_failure: {
            restart_from: gate.onFailure.restartFrom,
            ...(hasOnFailureFeedback ? {feedback: gate.onFailure.feedback} : {}),
          },
        }
      : {}),
  };
}

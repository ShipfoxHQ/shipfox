import type {WorkflowExpressionEvaluationContext} from '../evaluator/evaluate-workflow-expression.js';
import {hoistPlannedRunCommand} from '../run/hoist-run-command.js';
import type {
  AvailabilitySite,
  WorkflowInterpolationFailurePolicy,
} from '../workflow-context/workflow-context.js';
import {freezeResolvedFieldAtSite, type WorkflowTemplateDiagnostic} from './freeze.js';
import type {ResolvedField} from './resolved-field.js';

export interface FrozenPlannedRunCommand {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
}

export function freezePlannedRunCommandAtSite(params: {
  readonly field: ResolvedField;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly failurePolicy: WorkflowInterpolationFailurePolicy;
  readonly reservedNames?: Iterable<string>;
}): FrozenPlannedRunCommand {
  const hoisted = hoistPlannedRunCommand({
    field: params.field,
    ...(params.reservedNames === undefined ? {} : {reservedNames: params.reservedNames}),
  });
  const env: Record<string, string> = {};
  const diagnostics: WorkflowTemplateDiagnostic[] = [];

  for (const binding of hoisted.bindings) {
    const resolved = freezeResolvedFieldAtSite({
      field: {segments: [binding.segment]},
      site: params.site,
      context: params.context,
      failurePolicy: params.failurePolicy,
    });
    env[binding.name] = resolved.value;
    diagnostics.push(...resolved.diagnostics);
  }

  return {command: hoisted.command, env, diagnostics};
}

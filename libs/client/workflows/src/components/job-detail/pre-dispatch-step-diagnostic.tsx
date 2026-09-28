import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import type {StepSourceLocation} from '#core/workflow-run.js';
import {workflowRunSearchParams} from '#routes/inputs.js';

export interface PreDispatchStepDiagnostic {
  field?: string | undefined;
  source?: string | undefined;
  /** Set when an action input failed its declared type; names the input and the rule. */
  actionInputProblem?: string | undefined;
}

export function preDispatchStepDiagnostic(
  attemptStatus: string,
  attemptError: Record<string, unknown> | null,
): PreDispatchStepDiagnostic | undefined {
  if (attemptStatus !== 'failed') return undefined;
  const field = diagnosticValue(attemptError?.field);
  if (attemptError?.reason === 'action_input_invalid') {
    return {
      ...(field === undefined ? {} : {field}),
      actionInputProblem: diagnosticValue(attemptError.message) ?? 'The input is invalid.',
    };
  }
  if (attemptError?.reason !== 'config_unresolvable') return undefined;

  const source = diagnosticValue(attemptError.source);
  return {
    ...(field === undefined ? {} : {field}),
    ...(source === undefined ? {} : {source}),
  };
}

export function PreDispatchStepDiagnostic({
  diagnostic,
  stepLabel,
  stepId,
  attemptId,
  attemptOrdinal,
  sourceLocation,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
}: {
  diagnostic: PreDispatchStepDiagnostic;
  stepLabel: string;
  stepId: string;
  attemptId: string;
  attemptOrdinal: number;
  sourceLocation: StepSourceLocation | null;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
}) {
  return (
    <section
      aria-label={`${stepLabel} configuration diagnostic, attempt ${attemptOrdinal}`}
      className="flex min-w-0 flex-col gap-group border-t border-border-neutral-base bg-background-neutral-base px-row py-panel-compact"
    >
      <div className="flex min-w-0 max-w-[720px] flex-col gap-tight">
        <Text as="h3" size="sm" bold className="text-foreground-neutral-base">
          Step did not run
        </Text>
        <Text size="sm" className="text-foreground-neutral-subtle">
          {diagnostic.actionInputProblem
            ? 'An action input does not match its declaration in action.yml. Fix the step’s with: value or the declaration, then run again.'
            : 'Shipfox could not resolve this step’s configuration before dispatch.'}
        </Text>
      </div>
      {diagnostic.field || diagnostic.source || diagnostic.actionInputProblem ? (
        <dl className="flex min-w-0 max-w-[720px] flex-col gap-cluster">
          {diagnostic.field ? (
            <div className="flex min-w-0 flex-col gap-tight">
              <Text as="dt" size="xs" bold className="text-foreground-neutral-muted">
                Configuration field
              </Text>
              <Code as="dd" variant="label" className="break-all text-foreground-neutral-base">
                {diagnostic.field}
              </Code>
            </div>
          ) : null}
          {diagnostic.actionInputProblem ? (
            <div className="flex min-w-0 flex-col gap-tight">
              <Text as="dt" size="xs" bold className="text-foreground-neutral-muted">
                Problem
              </Text>
              <Text as="dd" size="sm" className="break-words text-foreground-neutral-base">
                {diagnostic.actionInputProblem}
              </Text>
            </div>
          ) : null}
          {diagnostic.source ? (
            <div className="flex min-w-0 flex-col gap-tight">
              <Text as="dt" size="xs" bold className="text-foreground-neutral-muted">
                Unavailable reference
              </Text>
              <Code as="dd" variant="label" className="break-all text-foreground-neutral-base">
                {diagnostic.source}
              </Code>
            </div>
          ) : null}
        </dl>
      ) : null}
      {sourceLocation ? (
        <Link
          to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
          params={{workspaceSlug, projectSlug, workflowRunId}}
          search={
            workflowRunSearchParams(
              {tab: 'source'},
              {stepId, stepAttemptId: attemptId, runAttempt},
            ) as never
          }
          className="inline-flex w-fit rounded-4 text-sm font-medium text-foreground-highlight-interactive underline-offset-2 outline-none hover:underline focus-visible:shadow-button-neutral-focus"
        >
          View in source
        </Link>
      ) : null}
    </section>
  );
}

function diagnosticValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

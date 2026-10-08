import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {
  Callout,
  CalloutActions,
  CalloutContent,
  CalloutDescription,
  CalloutTitle,
} from '@shipfox/react-ui/callout';
import {
  Inspector,
  InspectorBody,
  InspectorHeader,
  InspectorNotice,
  InspectorSection,
  InspectorSectionBody,
  InspectorSectionEmpty,
  JsonPropertyList,
  JsonPropertyValue,
  PropertyCode,
  PropertyDisclosureRow,
  PropertyList,
  PropertyRow,
  serializeJsonValue,
} from '@shipfox/react-ui/inspector';
import {TimeTickerProvider, useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code} from '@shipfox/react-ui/typography';
import {formatDuration} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {Fragment, type ReactNode} from 'react';
import {readActionStepConfig} from '#core/action-step.js';
import {conditionErrorDescription} from '#core/condition-error.js';
import type {
  JobStatusReason,
  Step,
  StepAttempt,
  StepAttemptDetail,
  StepAttemptInvocation,
  StepError,
  WorkflowDiagnosticUnavailableField,
} from '#core/workflow-run.js';
import {presentStepAttemptDiagnostics} from '#core/workflow-run.js';
import {useStepAttemptDetailQuery} from '#hooks/api/step-attempt-detail.js';
import {workflowRunSearchParams} from '#routes/inputs.js';
import {EvaluationTraceList} from '../evaluation-trace-list.js';
import {humanizeStatus, type StepListEntryModel} from '../step-list/step-list-model.js';
import {ActionStepDetails} from './action-step-details.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';
import {DiagnosticUnavailableAnnouncement, diagnosticFieldLabel} from './diagnostic-unavailable.js';
import {toSelectedAttemptError} from './job-empty-states.js';

export interface StepInspectorSheetProps {
  entry: StepListEntryModel;
  jobStatusReason?: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
  jobId: string;
  annotationCount?: number | undefined;
  onViewLogs?: (() => void) | undefined;
}

export function StepInspectorSheet({
  entry,
  jobStatusReason,
  open,
  onOpenChange,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  jobId,
  annotationCount,
  onViewLogs,
}: StepInspectorSheetProps) {
  const error = selectedStepError(entry.step, entry.error);
  const inspectorQuery = useStepAttemptDetailQuery(entry.step.id, entry.attempt, {
    enabled: open,
    polling: open && entry.status === 'running',
  });

  return (
    <Inspector
      label={entry.step.label}
      open={open}
      onClose={() => onOpenChange(false)}
      presentation="sheet"
    >
      <InspectorHeader
        title={entry.step.label}
        description={`Attempt #${entry.attemptOrdinal}`}
        status={
          <Badge variant={entry.statusVisual.badge} size="xs">
            {entry.statusVisual.label}
          </Badge>
        }
        badges={<StepKindBadge step={entry.step} />}
      />
      <InspectorBody>
        <StepInspector
          step={entry.step}
          attempt={entry}
          error={error}
          jobStatusReason={jobStatusReason}
          showFailure={entry.statusVisual.kind === 'failed' || entry.error !== null}
          query={inspectorQuery}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          workflowRunId={workflowRunId}
          runAttempt={runAttempt}
          jobId={jobId}
          annotationCount={annotationCount}
          onViewLogs={onViewLogs}
        />
      </InspectorBody>
    </Inspector>
  );
}

function StepKindBadge({step}: {step: Step}) {
  if (step.type === 'action') {
    return (
      <Badge variant="neutral" size="2xs" radius="rounded">
        Action
      </Badge>
    );
  }
  if (step.toolConfig?.sensitivity === 'write') {
    return (
      <Badge variant="warning" size="2xs" radius="rounded">
        Write tool
      </Badge>
    );
  }
  return null;
}

function StepFailureCallout({
  step,
  attempt,
  error,
  jobStatusReason,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  onViewLogs,
}: {
  step: Step;
  attempt: StepAttempt;
  error: StepError | null;
  jobStatusReason: string | null | undefined;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
  onViewLogs: (() => void) | undefined;
}) {
  const reason = failureReason(step, error, jobStatusReason);
  const toolGuidance =
    toolFailureGuidance(reason, step, attempt, error) ?? actionFailureGuidance(reason, step, error);
  const guidance = toolGuidance ?? checkoutCauseGuidance(reason, error);
  const title = guidance?.title ?? failureTitle(reason, error);
  const description =
    guidance?.description ?? failureDescription(reason, step, error, step.gateMaxAttempts);
  const failureCode = failureCodeForStep(step, error, reason);
  const sourceLink = sourceLinkForFailure(reason) && step.sourceLocation;

  if (step.type === 'agent' && reason === 'agent_config_invalid') {
    return (
      <AgentConfigFailureCallout
        workspaceSlug={workspaceSlug}
        config={step.agentConfig}
        error={error}
      />
    );
  }

  return (
    <Callout
      role="alert"
      type="error"
      variant="secondary"
      className="rounded-8 border border-tag-error-border p-panel-compact shadow-none"
    >
      <CalloutContent>
        <CalloutTitle>{title}</CalloutTitle>
        <CalloutDescription>
          <div className="flex min-w-0 flex-wrap items-center gap-x-inline gap-y-tight">
            <div className="flex min-w-0 flex-col gap-tight">
              <span>{description}</span>
              <FailureMessage error={error} />
              <ProviderMessage error={error} />
            </div>
            <Code as="span" variant="label" className="text-tag-error-text">
              {failureCode}
            </Code>
            <ProviderStreamDetails step={step} error={error} />
            {sourceLink ? (
              <Link
                to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
                params={{workspaceSlug, projectSlug, workflowRunId}}
                search={
                  workflowRunSearchParams(
                    {tab: 'source'},
                    {stepId: step.id, stepAttemptId: attempt.id, runAttempt},
                  ) as never
                }
                className="font-medium text-foreground-highlight-interactive underline-offset-2 hover:underline"
              >
                View in source
              </Link>
            ) : null}
            {toolGuidance?.recoveryLabel ? (
              <Link
                to="/w/$workspaceSlug/settings/integrations"
                params={{workspaceSlug}}
                className="font-medium text-foreground-highlight-interactive underline-offset-2 hover:underline"
              >
                {toolGuidance.recoveryLabel}
              </Link>
            ) : null}
          </div>
        </CalloutDescription>
      </CalloutContent>
      {(step.type === 'tool' || step.type === 'action') &&
      reason !== 'config_unresolvable' &&
      onViewLogs ? (
        <CalloutActions>
          <Button type="button" size="2xs" variant="secondary" onClick={onViewLogs}>
            {step.type === 'tool' ? 'View invocation log' : 'View logs'}
          </Button>
        </CalloutActions>
      ) : null}
    </Callout>
  );
}

function failureReason(
  step: Step,
  error: StepError | null,
  jobStatusReason: string | null | undefined,
): string | JobStatusReason {
  const stepReason = error?.reason ?? step.statusReason ?? 'unknown';
  if (stepReason !== 'runner_lost') return stepReason;

  switch (jobStatusReason) {
    case 'lease_expired':
    case 'provider_lost':
    case 'lifecycle_violation':
      return jobStatusReason;
    default:
      return stepReason;
  }
}

function StepInspector({
  step,
  attempt,
  error,
  jobStatusReason,
  showFailure,
  query,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  jobId,
  annotationCount,
  onViewLogs,
}: {
  step: Step;
  attempt: StepAttempt;
  error: StepError | null;
  jobStatusReason: string | null | undefined;
  showFailure: boolean;
  query: ReturnType<typeof useStepAttemptDetailQuery>;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt: number;
  jobId: string;
  annotationCount: number | undefined;
  onViewLogs: (() => void) | undefined;
}) {
  const detail = query.data;
  const hasAnnotations = annotationCount !== undefined && annotationCount > 0;

  return (
    <>
      {showFailure ? (
        <InspectorNotice>
          <StepFailureCallout
            step={step}
            attempt={attempt}
            error={error}
            jobStatusReason={jobStatusReason}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={workflowRunId}
            runAttempt={runAttempt}
            onViewLogs={onViewLogs}
          />
        </InspectorNotice>
      ) : null}
      <InspectorQueryContent
        query={query}
        detail={detail}
        step={step}
        attempt={attempt}
        showFailure={showFailure}
        hasAnnotations={hasAnnotations}
        workflowRunId={workflowRunId}
        runAttempt={runAttempt}
      />
      {hasAnnotations ? (
        <InspectorSection
          title="Annotations"
          count={annotationCount}
          aside={
            <Link
              to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
              params={{workspaceSlug, projectSlug, workflowRunId}}
              search={workflowRunSearchParams({tab: 'annotations'}, {jobId, runAttempt}) as never}
              className="rounded-4 text-xs text-foreground-highlight-interactive underline-offset-2 hover:underline focus-visible:shadow-button-neutral-focus"
            >
              View {annotationCount} annotation{annotationCount === 1 ? '' : 's'}
            </Link>
          }
        />
      ) : null}
      {!query.isPending && !query.isError && !detail && !showFailure && !hasAnnotations ? (
        <EmptyInspector />
      ) : null}
    </>
  );
}

function InspectorQueryContent({
  query,
  detail,
  step,
  attempt,
  showFailure,
  hasAnnotations,
  workflowRunId,
  runAttempt,
}: {
  query: ReturnType<typeof useStepAttemptDetailQuery>;
  detail: ReturnType<typeof useStepAttemptDetailQuery>['data'];
  step: Step;
  attempt: StepAttempt;
  showFailure: boolean;
  hasAnnotations: boolean;
  workflowRunId: string;
  runAttempt: number;
}) {
  if (query.isPending) {
    return (
      <InspectorNotice role="status" aria-label="Loading troubleshooting details">
        Loading troubleshooting details…
      </InspectorNotice>
    );
  }
  if (query.isError && detail === undefined) {
    return (
      <InspectorNotice>
        <Callout role="alert" type="warning" variant="secondary">
          <CalloutContent>
            <CalloutTitle>Details unavailable</CalloutTitle>
            <CalloutDescription className="flex items-center justify-between gap-inline">
              <span>Shipfox cannot load the details of this attempt.</span>
              <RetryButton query={query} />
            </CalloutDescription>
          </CalloutContent>
        </Callout>
      </InspectorNotice>
    );
  }
  if (!detail) {
    return showFailure || hasAnnotations ? null : <EmptyInspector />;
  }
  return (
    <>
      {query.isError ? (
        <InspectorNotice>
          <Callout role="status" aria-live="polite" type="warning" variant="secondary">
            <CalloutContent>
              <CalloutDescription className="flex items-center justify-between gap-inline">
                <span>Shipfox cannot refresh these details.</span>
                <RetryButton query={query} />
              </CalloutDescription>
            </CalloutContent>
          </Callout>
        </InspectorNotice>
      ) : null}
      <InspectorDetailContent
        detail={detail}
        step={step}
        attempt={attempt}
        showFailure={showFailure}
        hasAnnotations={hasAnnotations}
        workflowRunId={workflowRunId}
        runAttempt={runAttempt}
      />
    </>
  );
}

function RetryButton({query}: {query: ReturnType<typeof useStepAttemptDetailQuery>}) {
  return (
    <Button
      type="button"
      size="2xs"
      variant="secondary"
      isLoading={query.isFetching}
      onClick={() => void query.refetch()}
    >
      Retry
    </Button>
  );
}

function InspectorDetailContent({
  detail,
  step,
  attempt,
  showFailure,
  hasAnnotations,
  workflowRunId,
  runAttempt,
}: {
  detail: NonNullable<ReturnType<typeof useStepAttemptDetailQuery>['data']>;
  step: Step;
  attempt: StepAttempt;
  showFailure: boolean;
  hasAnnotations: boolean;
  workflowRunId: string;
  runAttempt: number;
}) {
  const trace = detail.evaluationTrace ?? [];
  const resolvedConfig = detail.config ?? null;
  const presentedAttempt = presentStepAttemptDiagnostics(attempt, detail);
  const unavailableFields = detail.oversizedFields ?? [];
  const isToolStep = step.type === 'tool';
  const actionConfig = step.type === 'action' ? readActionStepConfig(resolvedConfig) : null;
  const hasInputValues = inspectorHasInputValues(detail.authoredConfig, resolvedConfig);
  const hasOutputValues = inspectorHasOutputValues(presentedAttempt);
  const hasDetails =
    hasInputValues ||
    hasOutputValues ||
    trace.length > 0 ||
    unavailableFields.length > 0 ||
    hasVisibleAttemptDiagnostics(detail);
  return (
    <>
      {detail.session ? <SessionSection session={detail.session} /> : null}
      {isToolStep ? (
        <ToolStepDetails detail={detail} attempt={presentedAttempt} showFailure={showFailure} />
      ) : null}
      {actionConfig ? (
        <ActionStepDetails
          config={actionConfig}
          stepLabel={step.name}
          stepId={step.id}
          attempt={attempt.attempt}
          workflowRunId={workflowRunId}
          runAttempt={runAttempt}
        />
      ) : null}
      {!isToolStep && !actionConfig && hasInputValues ? (
        <ConfigSection authoredConfig={detail.authoredConfig} resolvedConfig={resolvedConfig} />
      ) : null}
      {!isToolStep && hasOutputValues ? <InspectorOutputs attempt={presentedAttempt} /> : null}
      {trace.length > 0 ? (
        <InspectorSection title="Evaluation" count={trace.length}>
          <EvaluationTraceList trace={trace} />
        </InspectorSection>
      ) : null}
      <UnavailableDiagnosticsSection fields={unavailableFields} />
      <AttemptDiagnostics detail={detail} />
      {isToolStep || actionConfig || hasDetails || showFailure || hasAnnotations ? null : (
        <EmptyInspector />
      )}
    </>
  );
}

function inspectorHasInputValues(
  authoredConfig: Record<string, unknown> | null,
  resolvedConfig: Record<string, unknown> | null,
): boolean {
  return countConfigValues(authoredConfig) > 0 || countConfigValues(resolvedConfig) > 0;
}

function inspectorHasOutputValues(attempt: StepAttempt): boolean {
  return attempt.outputs !== null || attempt.output !== null || attempt.response !== null;
}

function UnavailableDiagnosticsSection({
  fields,
}: {
  fields: readonly WorkflowDiagnosticUnavailableField[];
}) {
  if (fields.length === 0) return null;
  return (
    <InspectorSection title="Unavailable diagnostics" count={fields.length}>
      <PropertyList>
        {fields.map((field) => (
          <PropertyRow
            key={`${field.field}-${field.storedBytes}`}
            label={diagnosticFieldLabel(field.field)}
            meta={
              <Badge size="2xs" variant="warning">
                Unavailable
              </Badge>
            }
          >
            Too large to display ({field.storedBytes.toLocaleString()} bytes)
          </PropertyRow>
        ))}
      </PropertyList>
      <DiagnosticUnavailableAnnouncement count={fields.length} />
    </InspectorSection>
  );
}

function AttemptDiagnostics({detail}: {detail: StepAttemptDetail}) {
  if (!hasVisibleAttemptDiagnostics(detail)) return null;

  return (
    <InspectorSection title="Attempt diagnostics">
      <PropertyList>
        {hasDiagnosticObject(detail.error) ? (
          <PropertyRow
            label="Failure"
            copyValue={serializeJsonValue(detail.error)}
            copyLabel="Copy failure"
          >
            <JsonPropertyValue value={detail.error} />
          </PropertyRow>
        ) : null}
        {hasVisibleGateResult(detail.gateResult) ? (
          <PropertyRow
            label="Gate result"
            copyValue={serializeJsonValue(detail.gateResult)}
            copyLabel="Copy gate result"
          >
            <JsonPropertyValue value={detail.gateResult} />
          </PropertyRow>
        ) : null}
        {detail.restartFeedback ? (
          <PropertyRow label="Restart feedback">
            <span className="whitespace-pre-wrap font-display">{detail.restartFeedback}</span>
          </PropertyRow>
        ) : null}
      </PropertyList>
    </InspectorSection>
  );
}

function hasDiagnosticObject(value: Record<string, unknown> | null | undefined): boolean {
  return value !== null && value !== undefined && Object.keys(value).length > 0;
}

function hasVisibleGateResult(gateResult: StepAttemptDetail['gateResult']): boolean {
  return (
    gateResult !== undefined &&
    gateResult !== null &&
    gateResult.kind !== 'none' &&
    gateResult.kind !== 'not_evaluated'
  );
}

function hasVisibleAttemptDiagnostics(detail: StepAttemptDetail): boolean {
  return (
    hasDiagnosticObject(detail.error) ||
    hasVisibleGateResult(detail.gateResult) ||
    Boolean(detail.restartFeedback)
  );
}

function ToolStepDetails({
  detail,
  attempt,
  showFailure,
}: {
  detail: StepAttemptDetail;
  attempt: StepAttempt;
  showFailure: boolean;
}) {
  const result = toolResult(attempt);
  const mappedOutputs = toolMappedOutputs(attempt);
  const toolArguments = detail.toolArguments ?? {};
  return (
    <>
      {detail.authoredConfig && countConfigValues(detail.authoredConfig) > 0 ? (
        <InspectorSection title="Authored configuration">
          <JsonPropertyList value={detail.authoredConfig} />
        </InspectorSection>
      ) : null}
      <InspectorSection
        title="Arguments"
        count={
          isJsonObject(toolArguments) ? Object.keys(toolArguments).length || undefined : undefined
        }
      >
        {isJsonObject(toolArguments) && Object.keys(toolArguments).length === 0 ? (
          <InspectorSectionEmpty>No arguments were passed to this tool.</InspectorSectionEmpty>
        ) : (
          <JsonValueBlock value={toolArguments} copyLabel={(name) => `Copy argument ${name}`} />
        )}
      </InspectorSection>
      {!showFailure && result.present ? (
        <InspectorSection title="Result">
          <JsonValueBlock value={result.value} />
        </InspectorSection>
      ) : null}
      <InspectorSection title="Invocations" count={attempt.invocations.length || undefined}>
        <ToolInvocationList attempt={attempt} />
      </InspectorSection>
      {mappedOutputs ? (
        <InspectorSection title="Outputs" count={Object.keys(mappedOutputs).length}>
          <JsonPropertyList value={mappedOutputs} copyLabel={(name) => `Copy output ${name}`} />
        </InspectorSection>
      ) : null}
      {attempt.response !== null ? <ResponseSection response={attempt.response} /> : null}
    </>
  );
}

/** An object renders as property rows; any other JSON value as one flush code value. */
function JsonValueBlock({
  value,
  copyLabel,
}: {
  value: unknown;
  copyLabel?: ((name: string) => string) | undefined;
}) {
  if (isJsonObject(value) && Object.keys(value).length > 0) {
    return <JsonPropertyList value={value} copyLabel={copyLabel} />;
  }
  return (
    <InspectorSectionBody>
      <JsonPropertyValue value={value} />
    </InspectorSectionBody>
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ToolInvocationList({attempt}: {attempt: StepAttempt}) {
  const {invocations} = attempt;
  if (invocations.length === 0) {
    return (
      <InspectorSectionEmpty>
        No provider calls were recorded for this attempt.
      </InspectorSectionEmpty>
    );
  }

  return (
    <PropertyList>
      {invocations.map((invocation) => (
        <ToolInvocationRow
          key={invocation.callIndex}
          invocation={invocation}
          attemptActive={attempt.status === 'running'}
        />
      ))}
    </PropertyList>
  );
}

function ToolInvocationRow({
  invocation,
  attemptActive,
}: {
  invocation: StepAttemptInvocation;
  attemptActive: boolean;
}) {
  const visual = invocationVisual(invocation, attemptActive);
  return (
    <PropertyRow
      label={`Call ${invocation.callIndex + 1}`}
      labelFont="code"
      meta={
        <Badge variant={visual.badge} size="2xs" radius="rounded">
          {visual.label}
        </Badge>
      }
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-inline gap-y-tight">
        <InvocationTiming invocation={invocation} attemptActive={attemptActive} />
        {invocation.errorCode ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Code
                as="span"
                variant="label"
                tabIndex={0}
                className="truncate rounded-4 text-foreground-neutral-muted focus-visible:shadow-border-interactive-with-active focus-visible:outline-none"
              >
                {invocation.errorCode}
              </Code>
            </TooltipTrigger>
            <TooltipContent>
              <span className="block max-w-320 break-all">{invocation.errorCode}</span>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    </PropertyRow>
  );
}

function InvocationTiming({
  invocation,
  attemptActive,
}: {
  invocation: StepAttemptInvocation;
  attemptActive: boolean;
}) {
  if (attemptActive && invocation.nextDueAt && invocation.outcome === undefined) {
    return (
      <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={1000}>
        <RetryCountdown dueAt={invocation.nextDueAt} />
      </TimeTickerProvider>
    );
  }
  if (invocation.durationMs === undefined) return null;
  return <span className="shrink-0">{formatDuration(invocation.durationMs)}</span>;
}

function RetryCountdown({dueAt}: {dueAt: string}) {
  useTimeTick();
  const remainingMs = Date.parse(dueAt) - Date.now();
  const label = retryCountdownLabel(remainingMs);
  return <span className="shrink-0 tabular-nums">Retry in {label}</span>;
}

function retryCountdownLabel(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return 'pending';
  if (remainingMs <= 0) return 'now';
  return `${Math.ceil(remainingMs / 1000)}s`;
}

function invocationVisual(
  invocation: StepAttemptInvocation,
  attemptActive: boolean,
): {
  label: string;
  badge: 'neutral' | 'info' | 'success' | 'warning' | 'error';
} {
  if (invocation.outcome === 'success') return {label: 'Succeeded', badge: 'success'};
  if (invocation.outcome === 'error') return {label: 'Failed', badge: 'error'};
  if (invocation.outcome) return {label: humanizeStatus(invocation.outcome), badge: 'neutral'};
  if (!attemptActive) {
    return invocation.nextDueAt
      ? {label: 'Not retried', badge: 'neutral'}
      : {label: 'Interrupted', badge: 'warning'};
  }
  return invocation.nextDueAt
    ? {label: 'Retry pending', badge: 'warning'}
    : {label: 'Running', badge: 'info'};
}

function toolResult(attempt: StepAttempt): {present: boolean; value?: unknown} {
  for (const output of [attempt.output, attempt.outputs]) {
    if (output && Object.hasOwn(output, 'result')) return {present: true, value: output.result};
  }
  return {present: false};
}

function toolMappedOutputs(attempt: StepAttempt): Record<string, unknown> | null {
  const output = attempt.outputs ?? attempt.output;
  if (!output) return null;
  const mapped = Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'result'));
  return Object.keys(mapped).length > 0 ? mapped : null;
}

function InspectorOutputs({attempt}: {attempt: StepAttempt}) {
  const outputs = attempt.outputs ?? attempt.output;
  return (
    <>
      {outputs !== null ? (
        <InspectorSection title="Outputs" count={Object.keys(outputs).length || undefined}>
          {Object.keys(outputs).length > 0 ? (
            <JsonPropertyList value={outputs} copyLabel={(name) => `Copy output ${name}`} />
          ) : (
            <InspectorSectionEmpty>
              No outputs declared; the `outputs:` mapping is empty.
            </InspectorSectionEmpty>
          )}
        </InspectorSection>
      ) : null}
      {attempt.response !== null ? <ResponseSection response={attempt.response} /> : null}
    </>
  );
}

function ResponseSection({response}: {response: string}) {
  return (
    <InspectorSection title="Response">
      <InspectorSectionBody>
        <PropertyCode className="mt-0 whitespace-pre-wrap">{response}</PropertyCode>
      </InspectorSectionBody>
    </InspectorSection>
  );
}

function SessionSection({session}: {session: NonNullable<StepAttemptDetail['session']>}) {
  return (
    <InspectorSection
      title="Agent session"
      aside={
        <Badge variant="feature" size="2xs">
          {session.mode}
        </Badge>
      }
    >
      <PropertyList>
        <PropertyRow label="Key" copyValue={session.key} copyLabel="Copy session key">
          {session.key}
        </PropertyRow>
        <PropertyRow label="Prior session">
          {session.segment === 0 ? 'None loaded' : `Segment ${session.segment} loaded`}
        </PropertyRow>
      </PropertyList>
    </InspectorSection>
  );
}

/** Resolved values lead; the authored source opens behind a disclosure. */
function ConfigSection({
  authoredConfig,
  resolvedConfig,
}: {
  authoredConfig: Record<string, unknown> | null;
  resolvedConfig: Record<string, unknown> | null;
}) {
  const primary = resolvedConfig ?? authoredConfig ?? {};
  const authoredCount = countConfigValues(authoredConfig);
  return (
    <InspectorSection
      title="Inputs"
      aside={<Badge size="2xs">{resolvedConfig ? 'Resolved' : 'Authored'}</Badge>}
    >
      <JsonPropertyList value={primary} copyLabel={(name) => `Copy input ${name}`}>
        {resolvedConfig && authoredConfig && authoredCount > 0 ? (
          <PropertyDisclosureRow
            label="Authored configuration"
            summary={`${authoredCount} value${authoredCount === 1 ? '' : 's'}`}
            copyValue={serializeJsonValue(authoredConfig)}
            copyLabel="Copy authored configuration"
          >
            <PropertyCode>{serializeJsonValue(authoredConfig)}</PropertyCode>
          </PropertyDisclosureRow>
        ) : null}
      </JsonPropertyList>
    </InspectorSection>
  );
}

function EmptyInspector() {
  return <InspectorNotice>No additional troubleshooting details were recorded.</InspectorNotice>;
}

function selectedStepError(
  step: Step,
  attemptError: Record<string, unknown> | null,
): StepError | null {
  return toSelectedAttemptError(step, attemptError) ?? step.error;
}

function isProviderStreamFailure(error: StepError | null): boolean {
  return error?.code === 'provider_stream_interrupted';
}

function failureCodeForStep(step: Step, error: StepError | null, reason: string): string {
  if (isProviderStreamFailure(error)) return error?.category ?? 'provider';
  if (step.type === 'tool') return error?.code ?? reason;
  // A crashed or killed action process has no reason; its signal or exit code says more.
  if (step.type === 'action' && reason === 'unknown') {
    if (error?.signal) return error.signal;
    if (error?.exitCode !== null && error?.exitCode !== undefined) return `exit ${error.exitCode}`;
  }
  return reason;
}

function FailureMessage({error}: {error: StepError | null}): ReactNode {
  if (isProviderStreamFailure(error) || !error?.message) return null;
  return <span className="text-foreground-neutral-muted">{error.message}</span>;
}

function ProviderMessage({error}: {error: StepError | null}): ReactNode {
  if (!error?.providerMessage) return null;
  return (
    <span className="text-foreground-neutral-muted">
      The provider said:{' '}
      <span className="break-words font-code text-xs">{error.providerMessage}</span>
    </span>
  );
}

function ProviderStreamDetails({step, error}: {step: Step; error: StepError | null}): ReactNode {
  if (!isProviderStreamFailure(error) || !error) return null;

  const provider = providerDisplayName(step, error);
  const model = displayModel(step.agentConfig?.model);
  const attempts =
    error.attemptCount !== undefined && error.maxAttempts !== undefined
      ? `${error.attemptCount} of ${error.maxAttempts}`
      : undefined;
  const details = [
    ['Provider', provider],
    ['Model', model],
    ['Attempts', attempts],
    ['Error code', error.code],
  ].filter((detail): detail is [string, string] => detail[1] !== undefined);

  return (
    <dl className="grid min-w-0 basis-full grid-cols-[max-content_minmax(0,1fr)] gap-x-group gap-y-tight text-xs">
      {details.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-foreground-neutral-muted">{label}</dt>
          <dd className="min-w-0 break-all font-code text-foreground-neutral-base">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function displayProvider(provider: string | null | undefined): string | undefined {
  if (!provider) return undefined;
  return {shipfox: 'Shipfox'}[provider] ?? provider;
}

function providerDisplayName(step: Step, error: StepError): string {
  return (
    displayProvider(error.managedProviderId ?? step.agentConfig?.provider ?? 'shipfox') ?? 'Shipfox'
  );
}

function displayModel(model: string | null | undefined): string | undefined {
  if (!model) return undefined;
  return {'glm-5.3-flash': 'GLM 5.3 Flash'}[model] ?? model;
}

function failureTitle(reason: string | JobStatusReason, error: StepError | null): string {
  if (isProviderStreamFailure(error)) return 'The model response stopped';

  switch (reason) {
    case 'checkout_failed':
      return 'Checkout failed';
    case 'checkout_auth_failed':
      return 'The repository rejected the checkout';
    case 'checkout_unavailable':
      return 'The runner cannot reach the repository';
    case 'checkout_path_invalid':
      return 'The checkout path is not valid';
    case 'checkout_destination_occupied':
      return 'The checkout folder is not empty';
    case 'git_unavailable':
      return 'The runner cannot start Git';
    case 'workspace_prep_failed':
      return 'The runner cannot prepare the job';
    case 'container_setup_failed':
      return 'The job container did not start';
    case 'setup_aborted':
      return 'The job stopped during setup';
    case 'config_unresolvable':
      return 'A value in this step has an error';
    case 'output_invalid':
      return 'The step output has the wrong shape';
    case 'agent_config_invalid':
      return 'Check the agent step';
    case 'agent_invocation_failed':
      return 'The agent failed';
    case 'agent_harness_unavailable':
      return 'The agent cannot start';
    case 'agent_inference_credentials_unavailable':
      return 'Shipfox cannot reach the model provider';
    case 'agent_session_key_invalid':
      return 'The session name is not valid';
    case 'agent_session_held':
      return 'Another step is using this session';
    case 'agent_session_harness_mismatch':
      return 'This session uses another harness';
    case 'agent_session_unavailable':
      return 'Shipfox cannot load the session';
    case 'tool_error':
      return 'The integration returned an error';
    case 'tool_config_invalid':
      return 'A tool input is not valid';
    case 'invocation_interrupted':
      return 'The tool call stopped before it finished';
    case 'action_input_invalid':
      return 'An action input is not valid';
    case 'action_unavailable':
      return 'The runner cannot load the action';
    case 'gate_failed':
    case 'gate_uncheckable':
      return 'The success condition failed';
    case 'restart_unresolved':
      return 'The restart step does not exist';
    case 'restart_exhausted':
      return 'The step reached its attempt limit';
    case 'lease_expired':
    case 'provider_lost':
    case 'lifecycle_violation':
    case 'runner_lost':
      return 'The runner stopped responding';
    case 'output_too_large':
      return 'The job output is too large';
    case 'queue_timed_out':
      return 'No runner started this job in time';
    case 'runner_not_allowed':
      return 'This workspace cannot use the requested runner';
    case 'timed_out':
      return 'The step took too long';
    case 'step_failed':
      return 'A step failed';
    case 'dependency_not_completed':
      return 'A needed job did not finish';
    case 'condition_false':
    case 'condition_rejected':
      return 'The job condition skipped this job';
    case 'default_gate_rejected':
      return 'A needed job failed';
    case 'condition_errored':
      return 'A step condition has an error';
    case 'user_cancelled':
      return 'A user cancelled this job';
    case 'run_cancelled':
      return 'The run is cancelled';
    case 'unknown':
      return 'Shipfox does not know why this step failed';
    default:
      return 'The step failed';
  }
}

function restartExhaustionDescription(
  error: StepError | null,
  effectiveMaxAttempts: number | undefined,
): string {
  const attemptCount = error?.attemptCount;
  const maxAttempts = error?.maxAttempts ?? effectiveMaxAttempts;
  const hasNoSuccessGateDiagnostic = error?.message.startsWith('The step failed after ') ?? false;
  const subject = hasNoSuccessGateDiagnostic ? 'The step failed' : 'The success condition failed';
  const countCopy =
    attemptCount === undefined
      ? `${subject}.`
      : `${subject} ${attemptCount} ${attemptCount === 1 ? 'time' : 'times'}.`;
  const limitCopy =
    maxAttempts === undefined
      ? 'The step reached its limit.'
      : `The limit is ${maxAttempts} ${maxAttempts === 1 ? 'attempt' : 'attempts'}.`;
  return `${countCopy} ${limitCopy} Fix the cause, or raise gate.on_failure.max_attempts. Then start a new run.`;
}

function failureDescription(
  reason: string | JobStatusReason,
  step: Step,
  error: StepError | null,
  gateMaxAttempts?: number | undefined,
): string {
  if (isProviderStreamFailure(error) && error) {
    const attemptCount = error.attemptCount ?? 1;
    const attemptLabel = attemptCount === 1 ? 'time' : 'times';
    const provider = providerDisplayName(step, error);
    return `The connection to ${provider} dropped during the model response. Shipfox tried ${attemptCount} ${attemptLabel}. Your workflow has no error. Rerun the failed jobs.`;
  }

  switch (reason) {
    case 'checkout_failed':
      return 'Read the Git output in the step logs to find the cause. Then check the repository and ref of the checkout.';
    case 'checkout_auth_failed':
      return 'Check that the integration connection can read this repository. Then rerun the job.';
    case 'checkout_unavailable':
      return 'Rerun the job. If it fails again, check the network access of the runner.';
    case 'checkout_path_invalid':
      return 'Use a relative path inside the job folder, without .. or .git. Then start a new run.';
    case 'checkout_destination_occupied':
      return 'Choose an empty folder, or set force to replace its content. Then start a new run.';
    case 'git_unavailable':
      return 'Install Git in the runner image. Then rerun the job.';
    case 'workspace_prep_failed':
      return 'Read the setup logs for the cause. Then rerun the job.';
    case 'container_setup_failed':
      return 'Read the setup logs for the Docker error. Check the image name and registry credentials, then rerun the job.';
    case 'setup_aborted':
      return 'A user cancelled the job, or it reached its timeout, before setup finished. Rerun the job.';
    case 'config_unresolvable':
      return 'Shipfox cannot compute a value in this step. Fix the expression, then start a new run.';
    case 'output_invalid':
      return 'The step output does not match the declared outputs. Fix the step or the declaration, then start a new run.';
    case 'agent_config_invalid':
      return 'Shipfox cannot read the settings of this agent step. Check the step in the workflow file.';
    case 'agent_invocation_failed':
      return 'The agent stopped with an error. Read the step logs for the cause.';
    case 'agent_harness_unavailable':
      return 'The runner cannot start the agent. Rerun the job.';
    case 'agent_inference_credentials_unavailable':
      return 'Rerun the job. If it fails again, check the model provider in Agents settings.';
    case 'agent_session_key_invalid':
      return 'Start the session name with a letter or digit. Use only letters, digits, dots, underscores, or hyphens.';
    case 'agent_session_held':
      return 'Two steps that run at the same time cannot continue one session. Give each step its own session.';
    case 'agent_session_harness_mismatch':
      return 'A session works with one harness only. Use the harness of the first step, or use a new session.';
    case 'agent_session_unavailable':
      return 'Rerun the failed jobs. If it fails again, use a new session.';
    case 'tool_error':
      return 'Read the error below. Fix the cause, then rerun the job.';
    case 'tool_config_invalid':
      return error?.field
        ? `The value of ${error.field} is not valid. Fix it in the step, then start a new run.`
        : 'A tool input is not valid. Fix it in the step, then start a new run.';
    case 'invocation_interrupted':
      return step.toolConfig?.sensitivity === 'write'
        ? 'The change may already exist. Check the integration before you rerun the job.'
        : 'Shipfox does not know the result of the call. Read the invocation log, then rerun the job.';
    case 'action_input_invalid':
      return 'A with: value does not match the input in action.yml. Fix the value or the input, then start a new run.';
    case 'action_unavailable':
      return 'Rerun the job. If it fails again, contact your workspace admin.';
    case 'gate_failed':
      return 'The step finished, but its success condition is false. Fix the step or the condition, then start a new run.';
    case 'gate_uncheckable':
      return 'Shipfox cannot evaluate the success condition. Fix the condition or the values it uses, then start a new run.';
    case 'restart_unresolved':
      return 'Shipfox cannot find the step in gate.on_failure.restart_from. Fix it, then start a new run.';
    case 'restart_exhausted':
      return restartExhaustionDescription(error, gateMaxAttempts);
    case 'lease_expired':
    case 'provider_lost':
    case 'lifecycle_violation':
    case 'runner_lost':
      return 'Rerun the job. If it fails again, contact your workspace admin.';
    case 'timed_out':
      return 'The step did not finish before its timeout. Raise the timeout or make the step faster, then start a new run.';
    case 'queue_timed_out':
      return 'No runner was free before the queue timeout. Rerun the job when a runner is free.';
    case 'output_too_large':
      return 'Make the job outputs smaller, or write large data to a file.';
    case 'runner_not_allowed':
      return 'Choose another runner, then start a new run. Or contact your workspace admin.';
    case 'dependency_not_completed':
      return 'This job needs another job that did not finish.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The if condition of this job is false.';
    case 'condition_errored':
      return error?.message
        ? `${error.message} Fix the condition, then start a new run.`
        : (conditionErrorDescription(step.evaluationTrace) ??
            'Shipfox cannot evaluate the if condition of this step. Fix it, then start a new run.');
    case 'default_gate_rejected':
      return 'This job needs another job that did not succeed.';
    case 'step_failed':
      return 'A step failed before this job could finish.';
    case 'user_cancelled':
    case 'run_cancelled':
      return 'Start a new run if you still need the result.';
    case 'unknown':
      return 'Read the logs for details. Then rerun the job.';
    default:
      return 'Read the details below. Then rerun the job.';
  }
}

interface ToolFailureGuidance {
  title: string;
  description: string;
  recoveryLabel?: string | undefined;
}

const TOOL_FAILURE_GUIDANCE_BY_CODE: Readonly<Record<string, ToolFailureGuidance>> = {
  'access-denied': {
    title: 'The integration denied access',
    description: 'Check the permissions of the integration connection. Then rerun the job.',
    recoveryLabel: 'Review integration access',
  },
  'credentials-unavailable': {
    title: 'Reconnect the integration',
    description:
      'Shipfox cannot use the credentials of this integration. Reconnect it, then rerun the job.',
    recoveryLabel: 'Reconnect integration',
  },
};

const SUCCESSFUL_TOOL_OUTPUT_FAILURE_GUIDANCE: ToolFailureGuidance = {
  title: 'The tool call worked, but the step failed',
  description:
    'Shipfox cannot save the result as step output. The result is too large or has the wrong shape. The invocation log has the full result.',
};

function toolFailureGuidance(
  reason: string | JobStatusReason,
  step: Step,
  attempt: StepAttempt,
  error: StepError | null,
): ToolFailureGuidance | null {
  if (step.type !== 'tool') return null;
  if (toolCallSucceededBeforeFailure(reason, attempt)) {
    return SUCCESSFUL_TOOL_OUTPUT_FAILURE_GUIDANCE;
  }
  return error?.code ? (TOOL_FAILURE_GUIDANCE_BY_CODE[error.code] ?? null) : null;
}

// Causes the checkout-token route names, with the same copy as the failure annotation.
// `access-denied` and `provider-rejected` cover several causes, so they claim none and
// rely on the provider's explanation shown below.
const CHECKOUT_CAUSE_GUIDANCE_BY_CODE: Readonly<Record<string, ToolFailureGuidance>> = {
  'repository-not-granted': {
    title: 'Shipfox is not allowed to check out this repository',
    description:
      'Link a project to the repository, or let the connection use all repositories. Then rerun the job.',
  },
  'checkout-repository-not-authorized': {
    title: 'Shipfox is not allowed to check out this repository',
    description: 'Use a project of this workspace in checkout.project. Then start a new run.',
  },
  'installation-inactive': {
    title: 'The GitHub App installation is suspended or removed',
    description: 'Unsuspend or reinstall the Shipfox GitHub App. Then rerun the job.',
  },
  'repository-not-found': {
    title: 'The provider cannot find the repository',
    description:
      'Check the repository name, and that the connection includes the repository. Then rerun the job.',
  },
  'access-denied': {
    title: 'The provider denied access to the repository',
    description: 'Check the permissions and the repository access of the connection.',
  },
  'provider-rejected': {
    title: 'The provider rejected the checkout request',
    description: 'Read the step logs for the request that failed.',
  },
  'integration-connection-inactive': {
    title: 'The checkout connection is disabled',
    description: 'Enable the connection in the integration settings. Then rerun the job.',
  },
  'checkout-unavailable': {
    title: 'The checkout connection or project does not exist',
    description:
      'Fix checkout.connection or checkout.project in the workflow. Then start a new run.',
  },
};

function checkoutCauseGuidance(
  reason: string | JobStatusReason,
  error: StepError | null,
): ToolFailureGuidance | null {
  if (reason !== 'checkout_failed' && reason !== 'checkout_auth_failed') return null;
  return error?.code ? (CHECKOUT_CAUSE_GUIDANCE_BY_CODE[error.code] ?? null) : null;
}

const OUT_OF_MEMORY_MESSAGE = /out of memory/iu;

const ACTION_EARLY_EXIT_GUIDANCE: ToolFailureGuidance = {
  title: 'The action exited before it finished',
  description:
    'The process ended before its handler returned, for example through an early process.exit(). Return from the handler, or throw to fail the step.',
};

const ACTION_OUT_OF_MEMORY_GUIDANCE: ToolFailureGuidance = {
  title: 'The action ran out of memory',
  description:
    'The system stopped the action process; the runner kept running. Hold less in memory, for example by writing large data to files as it arrives.',
};

const ACTION_OUTPUT_INVALID_GUIDANCE: ToolFailureGuidance = {
  title: 'An action output is not valid',
  description:
    'An output is missing, not declared in action.yml, or of the wrong type. Match the outputs to action.yml, then start a new run.',
};

const ACTION_OUTPUT_TOO_LARGE_GUIDANCE: ToolFailureGuidance = {
  title: 'Action output is too large',
  description:
    'Outputs are limited to 64 KiB per value and 256 KiB in total. Write large results to a file and output its path.',
};

// The runner reports early exits and out-of-memory kills in the failure message.
function actionFailureGuidance(
  reason: string | JobStatusReason,
  step: Step,
  error: StepError | null,
): ToolFailureGuidance | null {
  if (step.type !== 'action') return null;
  if (reason === 'output_invalid') return ACTION_OUTPUT_INVALID_GUIDANCE;
  if (reason === 'step_result_too_large') return ACTION_OUTPUT_TOO_LARGE_GUIDANCE;
  const message = error?.message ?? '';
  if (message.includes('exited before it finished')) return ACTION_EARLY_EXIT_GUIDANCE;
  if (OUT_OF_MEMORY_MESSAGE.test(message)) return ACTION_OUT_OF_MEMORY_GUIDANCE;
  return null;
}

function sourceLinkForFailure(reason: string | JobStatusReason): boolean {
  return (
    reason === 'config_unresolvable' ||
    reason === 'agent_config_invalid' ||
    reason === 'tool_config_invalid' ||
    reason === 'action_input_invalid' ||
    reason === 'output_invalid' ||
    reason === 'default_gate_rejected' ||
    reason === 'condition_rejected' ||
    reason === 'condition_errored' ||
    reason === 'gate_failed' ||
    reason === 'gate_uncheckable' ||
    reason === 'restart_unresolved' ||
    reason === 'restart_exhausted'
  );
}

function toolCallSucceededBeforeFailure(
  reason: string | JobStatusReason,
  attempt: StepAttempt,
): boolean {
  return (
    reason === 'output_invalid' &&
    attempt.invocations.some((invocation) => invocation.outcome === 'success')
  );
}

function countConfigValues(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((total, item) => total + countConfigValues(item), 0);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce((total, item) => total + countConfigValues(item), 0);
  }
  return value === undefined ? 0 : 1;
}

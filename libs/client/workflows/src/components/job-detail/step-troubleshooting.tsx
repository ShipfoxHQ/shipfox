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
        badges={
          entry.step.toolConfig?.sensitivity === 'write' ? (
            <Badge variant="warning" size="2xs" radius="rounded">
              Write tool
            </Badge>
          ) : null
        }
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
  const toolGuidance = toolFailureGuidance(reason, step, attempt, error);
  const title = toolGuidance?.title ?? failureTitle(reason, error);
  const description =
    toolGuidance?.description ?? failureDescription(reason, step, error, step.gateMaxAttempts);
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
      {step.type === 'tool' && reason !== 'config_unresolvable' && onViewLogs ? (
        <CalloutActions>
          <Button type="button" size="2xs" variant="secondary" onClick={onViewLogs}>
            View invocation log
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
}: {
  query: ReturnType<typeof useStepAttemptDetailQuery>;
  detail: ReturnType<typeof useStepAttemptDetailQuery>['data'];
  step: Step;
  attempt: StepAttempt;
  showFailure: boolean;
  hasAnnotations: boolean;
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
              <span>We could not load the resolved configuration for this attempt.</span>
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
                <span>Could not refresh troubleshooting details.</span>
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
}: {
  detail: NonNullable<ReturnType<typeof useStepAttemptDetailQuery>['data']>;
  step: Step;
  attempt: StepAttempt;
  showFailure: boolean;
  hasAnnotations: boolean;
}) {
  const trace = detail.evaluationTrace ?? [];
  const resolvedConfig = detail.config ?? null;
  const presentedAttempt = presentStepAttemptDiagnostics(attempt, detail);
  const unavailableFields = detail.oversizedFields ?? [];
  const isToolStep = step.type === 'tool';
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
      {!isToolStep && hasInputValues ? (
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
      {isToolStep || hasDetails || showFailure || hasAnnotations ? null : <EmptyInspector />}
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
  return reason;
}

function FailureMessage({error}: {error: StepError | null}): ReactNode {
  if (isProviderStreamFailure(error) || !error?.message) return null;
  return <span className="text-foreground-neutral-muted">{error.message}</span>;
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
  if (isProviderStreamFailure(error)) return 'Model response interrupted';

  switch (reason) {
    case 'checkout_failed':
      return 'Checkout failed';
    case 'checkout_auth_failed':
      return 'Checkout authentication failed';
    case 'checkout_unavailable':
      return 'Checkout service unavailable';
    case 'checkout_path_invalid':
      return 'Checkout path is invalid';
    case 'checkout_destination_occupied':
      return 'Checkout destination is already occupied';
    case 'git_unavailable':
      return 'Git was unavailable';
    case 'workspace_prep_failed':
      return 'Workspace preparation failed';
    case 'setup_aborted':
      return 'Step setup was aborted';
    case 'config_unresolvable':
      return 'Step configuration could not be resolved';
    case 'output_invalid':
      return 'Step output was invalid';
    case 'agent_config_invalid':
      return 'Agent configuration is invalid';
    case 'agent_invocation_failed':
      return 'Agent invocation failed';
    case 'agent_harness_unavailable':
      return 'Agent harness was unavailable';
    case 'agent_inference_credentials_unavailable':
      return 'Inference credentials are unavailable';
    case 'agent_session_key_invalid':
      return 'Agent session key is invalid';
    case 'agent_session_held':
      return 'Agent session is held by another attempt';
    case 'agent_session_harness_mismatch':
      return 'Agent session harness does not match';
    case 'agent_session_unavailable':
      return 'Agent session is unavailable';
    case 'tool_error':
      return 'Tool call failed';
    case 'tool_config_invalid':
      return 'Tool configuration is invalid';
    case 'invocation_interrupted':
      return 'Tool invocation was interrupted';
    case 'gate_failed':
    case 'gate_uncheckable':
      return 'Step validation failed';
    case 'restart_unresolved':
      return 'Gate restart target could not be resolved';
    case 'restart_exhausted':
      return 'Gate attempt limit reached';
    case 'lease_expired':
      return 'Connection to the runner was lost';
    case 'provider_lost':
      return 'The runner became unavailable';
    case 'lifecycle_violation':
      return 'Runner stopped unexpectedly';
    case 'runner_lost':
      return 'Runner stopped responding';
    case 'output_too_large':
      return 'Job output exceeded its size limit';
    case 'timed_out':
      return 'Step timed out';
    case 'step_failed':
      return 'A step failed';
    case 'dependency_not_completed':
      return 'A dependency did not complete';
    case 'condition_false':
      return 'The job condition was false';
    case 'default_gate_rejected':
      return 'The default gate rejected this job';
    case 'condition_rejected':
      return 'The job condition rejected this job';
    case 'condition_errored':
      return 'The job condition could not be evaluated';
    case 'user_cancelled':
      return 'The job was cancelled by a user';
    case 'run_cancelled':
      return 'The run was cancelled';
    case 'unknown':
      return 'The failure reason was not recorded';
    default:
      return 'Step failed';
  }
}

function restartExhaustionDescription(
  error: StepError | null,
  effectiveMaxAttempts: number | undefined,
): string {
  const attemptCount = error?.attemptCount;
  const maxAttempts = error?.maxAttempts ?? effectiveMaxAttempts;
  const hasNoSuccessGateDiagnostic = error?.message.startsWith('The step failed after ') ?? false;
  const subject = hasNoSuccessGateDiagnostic
    ? 'The step failed'
    : 'The success condition did not pass';
  const countCopy =
    attemptCount === undefined
      ? subject
      : `${subject} after ${attemptCount} ${attemptCount === 1 ? 'attempt' : 'attempts'}`;
  const limitCopy =
    maxAttempts === undefined
      ? 'and reached the gate attempt limit.'
      : `and reached the gate attempt limit of ${maxAttempts} ${maxAttempts === 1 ? 'attempt' : 'attempts'}, including the first execution.`;
  const recovery = hasNoSuccessGateDiagnostic
    ? 'Review the failed result.'
    : 'Review the failed result and gate.success condition.';
  return `${countCopy} ${limitCopy} ${recovery} To allow more attempts, set gate.on_failure.max_attempts to a higher value and start a new run.`;
}

function failureDescription(
  reason: string | JobStatusReason,
  step: Step,
  error: StepError | null,
  gateMaxAttempts?: number | undefined,
): string {
  if (isProviderStreamFailure(error) && error) {
    const attemptCount = error.attemptCount ?? 1;
    const attemptLabel = attemptCount === 1 ? 'attempt' : 'attempts';
    const provider = providerDisplayName(step, error);
    return `${provider} lost the model response stream after ${attemptCount} ${attemptLabel}. No workflow configuration error was detected. Rerun the failed jobs.`;
  }

  switch (reason) {
    case 'checkout_auth_failed':
      return 'Checkout credentials were rejected. Verify repository access before re-running.';
    case 'checkout_unavailable':
      return 'The checkout service was unavailable. Retry after the service recovers.';
    case 'git_unavailable':
      return 'The runner could not start Git. Check the runner image before re-running.';
    case 'workspace_prep_failed':
      return 'The runner could not prepare its workspace. Review the runner setup details.';
    case 'config_unresolvable':
      return 'The resolved configuration contains a value that could not be evaluated.';
    case 'output_invalid':
      return 'The step returned output that did not match the declared contract.';
    case 'agent_config_invalid':
      return 'The agent configuration is not valid for this step.';
    case 'agent_invocation_failed':
      return 'The agent invocation failed after configuration was accepted.';
    case 'agent_harness_unavailable':
      return 'The runner could not start the agent harness.';
    case 'agent_inference_credentials_unavailable':
      return 'Shipfox could not obtain inference credentials for this agent. Try again. If the problem continues, check the model provider configuration.';
    case 'agent_session_key_invalid':
      return 'The resolved agent session key does not match the allowed key format.';
    case 'agent_session_held':
      return 'Another running step currently holds this agent session. Parallel steps cannot share a session in resume mode.';
    case 'agent_session_harness_mismatch':
      return 'The step harness differs from the harness the agent session is pinned to.';
    case 'agent_session_unavailable':
      return 'The agent session was unavailable during dispatch. Review the error details below and retry after resolving the cause.';
    case 'tool_error':
      return 'The provider rejected or could not complete this tool call.';
    case 'tool_config_invalid':
      return error?.field
        ? `The resolved ${error.field} value is invalid. Fix the step configuration before re-running.`
        : 'The resolved tool configuration is invalid. Fix the step configuration before re-running.';
    case 'invocation_interrupted':
      return step.toolConfig?.sensitivity === 'write'
        ? 'The provider call was interrupted. Confirm whether the write completed before re-running it.'
        : 'The provider call was interrupted before its outcome could be recorded. Review the invocation log before retrying.';
    case 'gate_failed':
      return "The step completed, but its success condition was not met. Review the step's result and success condition before trying again.";
    case 'gate_uncheckable':
      return "Shipfox could not evaluate the step's success condition. Review the condition and the values it references before trying again.";
    case 'restart_unresolved':
      return 'Shipfox could not resolve the configured restart target. Review gate.on_failure.restart_from before trying again.';
    case 'restart_exhausted':
      return restartExhaustionDescription(error, gateMaxAttempts);
    case 'lease_expired':
    case 'provider_lost':
    case 'lifecycle_violation':
    case 'runner_lost':
    case 'timed_out':
      return 'Try the workflow again. If the problem continues, contact your workspace administrator.';
    case 'output_too_large':
      return 'The materialized job output exceeded its configured size limit.';
    case 'dependency_not_completed':
      return 'A required job did not complete, so this job could not start.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The job condition did not allow this job to run.';
    case 'condition_errored':
      return 'The job condition could not be evaluated.';
    case 'default_gate_rejected':
      return 'A required job did not succeed, so this job was not allowed to run.';
    case 'step_failed':
      return 'A step failed before this job could complete.';
    case 'user_cancelled':
    case 'run_cancelled':
      return 'Start a new run if you still need the result.';
    case 'unknown':
      return 'No machine-readable failure reason was recorded.';
    default:
      return `${humanize(reason)}. Review the details below and re-run after resolving the cause.`;
  }
}

interface ToolFailureGuidance {
  title: string;
  description: string;
  recoveryLabel?: string | undefined;
}

const TOOL_FAILURE_GUIDANCE_BY_CODE: Readonly<Record<string, ToolFailureGuidance>> = {
  'access-denied': {
    title: 'Tool access was denied',
    description:
      'The integration rejected this call. Review its permissions before re-running the step.',
    recoveryLabel: 'Review integration access',
  },
  'credentials-unavailable': {
    title: 'Tool credentials are unavailable',
    description:
      'The integration credentials are missing or unavailable. Reconnect the integration before re-running the step.',
    recoveryLabel: 'Reconnect integration',
  },
};

const SUCCESSFUL_TOOL_OUTPUT_FAILURE_GUIDANCE: ToolFailureGuidance = {
  title: 'Tool call succeeded, but the step failed',
  description:
    'The integration returned a result, but Shipfox could not map or store it because it did not satisfy the output contract or size limit. The full result remains available in the invocation log.',
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

function sourceLinkForFailure(reason: string | JobStatusReason): boolean {
  return (
    reason === 'config_unresolvable' ||
    reason === 'agent_config_invalid' ||
    reason === 'tool_config_invalid' ||
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

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countConfigValues(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((total, item) => total + countConfigValues(item), 0);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce((total, item) => total + countConfigValues(item), 0);
  }
  return value === undefined ? 0 : 1;
}

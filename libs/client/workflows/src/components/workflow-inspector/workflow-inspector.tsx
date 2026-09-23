import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {
  type JobExecutionUsage,
  JobUsageBreakdown,
  JobUsageCells,
  type RunUsage,
  RunUsageBreakdown,
  RunUsageSummary,
  useJobExecutionUsageQuery,
} from '@shipfox/client-usage';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Inspector,
  InspectorFact,
  InspectorFactSeparator,
  InspectorFacts,
  InspectorHeader,
  InspectorNotice,
  InspectorSection,
  InspectorSectionBody,
  InspectorSectionEmpty,
  InspectorTabs,
  JsonPropertyList,
  PropertyCode,
  PropertyDisclosureRow,
  PropertyList,
  PropertyRow,
  serializeJsonValue,
} from '@shipfox/react-ui/inspector';
import {TimeTickerProvider, useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Text} from '@shipfox/react-ui/typography';
import {Fragment, type ReactNode, type RefObject, useEffect} from 'react';
import {splitJobEvaluationTrace} from '#core/job-evaluation-trace.js';
import {
  type EvaluationTraceEntry,
  type EvaluationTraceValueEntry,
  isTerminalJobExecutionStatus,
  type JobExecutionTime,
  type WorkflowDiagnosticField,
  type WorkflowDiagnosticUnavailableField,
  type WorkflowExecutionEvent,
  type WorkflowJobExecutionContext,
  type WorkflowJobExecutionDetail,
  type WorkflowRunOverview,
  type WorkflowRunOverviewJob,
  workflowRunBranchLabel,
  workflowRunCommitLabel,
} from '#core/workflow-run.js';
import {useWorkflowJobExecutionContextQuery} from '#hooks/api/workflow-job-detail.js';
import type {WorkflowInspectorScope} from '#routes/inputs.js';
import {EvaluationFlags, EvaluationTraceList, EvaluationValue} from '../evaluation-trace-list.js';
import {
  DiagnosticUnavailableAnnouncement,
  diagnosticFieldLabel,
} from '../job-detail/diagnostic-unavailable.js';
import {
  describeJobExecutionTime,
  formatJobExecutionTime,
} from '../job-detail/job-execution-time-text.js';
import {WorkflowRunDurationLabel} from '../workflow-run-duration-label.js';
import {getWorkflowStatusVisual} from '../workflow-status/status-visuals.js';

export interface WorkflowExecutionInspectorSelection {
  job: WorkflowRunOverviewJob;
  execution: WorkflowJobExecutionDetail;
}

export interface WorkflowInspectorSelectionRead {
  status: 'pending' | 'ready' | 'error';
  onRetry: () => void;
}

export interface WorkflowInspectorProps {
  scope: WorkflowInspectorScope | undefined;
  run: WorkflowRunOverview | undefined;
  projectSlug?: string | undefined;
  workspaceId?: string | undefined;
  runUsage: RunUsage | undefined;
  executionSelection?: WorkflowExecutionInspectorSelection | undefined;
  selectionRead?: WorkflowInspectorSelectionRead | undefined;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}

export function WorkflowInspector({scope, ...props}: WorkflowInspectorProps) {
  if (!scope) return null;

  const key = `${scope}:${props.executionSelection?.execution.id ?? props.run?.id ?? 'loading'}`;
  return (
    <Inspector label="Workflow inspector" onClose={props.onClose}>
      <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
        <WorkflowInspectorContent key={key} scope={scope} {...props} />
      </TimeTickerProvider>
    </Inspector>
  );
}

function WorkflowInspectorContent({
  scope,
  run,
  projectSlug,
  workspaceId,
  runUsage,
  executionSelection,
  selectionRead,
  headingRef,
}: Omit<WorkflowInspectorProps, 'scope'> & {scope: WorkflowInspectorScope}) {
  const execution = executionSelection?.execution;
  const polling = executionInspectorPolling(scope, execution);
  const executionUsageQuery = useJobExecutionUsageQuery({
    workspaceId,
    jobExecutionId: execution?.id,
    enabled: scope === 'execution' && execution !== undefined,
    polling,
  });
  const contextQuery = useWorkflowJobExecutionContextQuery({
    jobId: executionSelection?.job.id,
    executionId: execution?.id,
    enabled: scope === 'execution' && execution !== undefined,
    polling,
  });
  const copy = inspectorHeaderCopy(scope, run, executionSelection, selectionRead);

  useEffect(() => {
    headingRef.current?.focus({preventScroll: true});
  }, [headingRef]);

  return (
    <>
      <InspectorHeader
        title={copy.title}
        description={copy.description}
        status={<InspectorStatus scope={scope} run={run} execution={execution} />}
        headingRef={headingRef}
      >
        {scope === 'run' && run ? <RunInspectorFacts run={run} usage={runUsage} /> : null}
        {scope === 'execution' && execution ? (
          <ExecutionInspectorFacts execution={execution} usage={executionUsageQuery.data} />
        ) : null}
      </InspectorHeader>
      {scope === 'run' ? (
        <RunInspectorTabs run={run} projectSlug={projectSlug} usage={runUsage} />
      ) : (
        <ExecutionInspectorTabs
          selection={executionSelection}
          selectionRead={selectionRead}
          contextQuery={contextQuery}
          cost={
            executionUsageQuery.data ? (
              <JobUsageBreakdown usage={executionUsageQuery.data} />
            ) : undefined
          }
        />
      )}
    </>
  );
}

function inspectorHeaderCopy(
  scope: WorkflowInspectorScope,
  run: WorkflowRunOverview | undefined,
  selection: WorkflowExecutionInspectorSelection | undefined,
  selectionRead: WorkflowInspectorSelectionRead | undefined,
): {title: string; description: string} {
  if (scope === 'run') {
    if (!run) return {title: 'Run details', description: 'Loading run details'};
    return {
      title: run.name,
      description: `Run ${run.number ?? run.id} · Attempt ${run.runAttempt.attempt}`,
    };
  }
  if (!selection) {
    let description = 'No execution selected';
    if (selectionRead?.status === 'pending') description = 'Loading execution details';
    else if (selectionRead?.status === 'error') description = 'Could not load execution';
    return {title: 'Execution details', description};
  }
  return {
    title: selection.job.displayName,
    description: `Execution ${selection.execution.sequence} · ${selection.execution.name}`,
  };
}

function executionInspectorPolling(
  scope: WorkflowInspectorScope,
  execution: WorkflowJobExecutionDetail | undefined,
): boolean {
  return Boolean(
    scope === 'execution' && execution && !isTerminalJobExecutionStatus(execution.status),
  );
}

function InspectorStatus({
  scope,
  run,
  execution,
}: {
  scope: WorkflowInspectorScope;
  run: WorkflowRunOverview | undefined;
  execution: WorkflowJobExecutionDetail | undefined;
}) {
  const status = scope === 'run' ? run?.runAttempt.status : execution?.status;
  if (!status) return null;
  const visual = getWorkflowStatusVisual(status);
  return (
    <Badge variant={visual.badge} size="xs">
      {visual.label}
    </Badge>
  );
}

function RunInspectorFacts({run, usage}: {run: WorkflowRunOverview; usage: RunUsage | undefined}) {
  const duration = run.runAttempt.displayDuration;
  return (
    <InspectorFacts>
      <RunTriggerFacts run={run} />
      {duration ? (
        <>
          <InspectorFactSeparator />
          <WorkflowRunDurationLabel duration={duration} hasStarted={run.hasStartedJobExecution} />
        </>
      ) : null}
      <RunUsageSummary runId={run.id} usage={usage} prefix={<InspectorFactSeparator />} />
    </InspectorFacts>
  );
}

function ExecutionInspectorFacts({
  execution,
  usage,
}: {
  execution: WorkflowJobExecutionDetail;
  usage: JobExecutionUsage | undefined;
}) {
  const runnerLabels = usage?.jobExecution.runnerLabels;
  const items: {key: string; content: ReactNode}[] = [];
  if (runnerLabels?.length) {
    items.push({
      key: 'runner',
      content: (
        <InspectorFact icon={<Icon name="serverLine" />}>{runnerLabels.join(', ')}</InspectorFact>
      ),
    });
  }
  if (execution.queuedAt) {
    items.push({
      key: 'queue',
      content: <InspectorDurationFact execution={execution} kind="queue" />,
    });
  }
  if (execution.startedAt) {
    items.push({key: 'run', content: <InspectorDurationFact execution={execution} kind="run" />});
  }

  return (
    <InspectorFacts>
      {items.map(({key, content}, index) => (
        <Fragment key={key}>
          {index > 0 ? <InspectorFactSeparator /> : null}
          {content}
        </Fragment>
      ))}
      <JobUsageCells usage={usage} prefix={items.length > 0 ? <InspectorFactSeparator /> : null} />
    </InspectorFacts>
  );
}

function InspectorDurationFact({
  execution,
  kind,
}: {
  execution: WorkflowJobExecutionDetail;
  kind: 'queue' | 'run';
}) {
  useTimeTick();
  const time = executionTime(execution, kind);
  if (!time) return null;
  return (
    <InspectorFact
      icon={<Icon name={kind === 'queue' ? 'hourglassLine' : 'timerLine'} />}
      description={describeJobExecutionTime(time, kind)}
    >
      {formatJobExecutionTime(time)}
    </InspectorFact>
  );
}

function RunTriggerFacts({run}: {run: WorkflowRunOverview}) {
  const reference = run.triggerReference;
  const trigger = run.triggerDisplayLabel || run.triggerSource || 'Unknown trigger';
  const triggerReference = {triggerReference: reference, devSource: null};
  const branch = workflowRunBranchLabel(triggerReference);
  const commit = workflowRunCommitLabel(triggerReference);
  const facts: {key: string; icon: ReactNode; description: string; value: string}[] = [
    {
      key: 'trigger',
      icon: <TriggerSourceIcon provider={run.triggerProvider} source={run.triggerSource} />,
      description: `Trigger: ${run.triggerLabel || trigger}`,
      value: trigger,
    },
  ];
  if (reference?.repository) {
    facts.push({
      key: 'repository',
      icon: <Icon name="gitRepositoryLine" />,
      description: `Repository: ${reference.repository}`,
      value: reference.repository,
    });
  }
  if (branch) {
    facts.push({
      key: 'reference',
      icon: <Icon name="gitBranchLine" />,
      description: `Reference: ${branch}`,
      value: branch,
    });
  }
  if (commit) {
    facts.push({
      key: 'commit',
      icon: <Icon name="gitCommitLine" />,
      description: `Commit: ${reference?.commit ?? commit}`,
      value: commit,
    });
  }
  if (reference?.actor) {
    facts.push({
      key: 'actor',
      icon: <Icon name="userLine" />,
      description: `Actor: ${reference.actor}`,
      value: reference.actor,
    });
  }

  return facts.map((fact, index) => (
    <Fragment key={fact.key}>
      {index > 0 ? <InspectorFactSeparator /> : null}
      <InspectorFact icon={fact.icon} description={fact.description}>
        {fact.value}
      </InspectorFact>
    </Fragment>
  ));
}

function RunInspectorTabs({
  run,
  projectSlug,
  usage,
}: {
  run: WorkflowRunOverview | undefined;
  projectSlug: string | undefined;
  usage: RunUsage | undefined;
}) {
  return (
    <InspectorTabs
      tabs={[
        {
          value: 'inputs',
          label: 'Inputs',
          count: run?.secretInputs.length,
          content: run ? (
            <RunInputs run={run} projectSlug={projectSlug} />
          ) : (
            <InspectorLoading subject="run inputs" />
          ),
        },
        ...(run && usage
          ? [
              {
                value: 'cost',
                label: 'Cost',
                content: (
                  <>
                    {run.currentAttempt > 1 || run.latestAttempt > 1 ? (
                      <InspectorNotice>Totals include all attempts.</InspectorNotice>
                    ) : null}
                    <RunUsageBreakdown runId={run.id} usage={usage} />
                  </>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

function RunInputs({
  run,
  projectSlug,
}: {
  run: WorkflowRunOverview;
  projectSlug: string | undefined;
}) {
  return (
    <InspectorSection title="Secret inputs" count={run.secretInputs.length || undefined}>
      {run.secretInputs.length > 0 ? (
        <PropertyList>
          {run.secretInputs.map((input) => (
            <PropertyRow
              key={input.name}
              label={input.name}
              labelFont="code"
              meta={<Badge size="2xs">{secretInputScopeLabel(input.projectId, projectSlug)}</Badge>}
            >
              {input.key}
            </PropertyRow>
          ))}
        </PropertyList>
      ) : (
        <InspectorSectionEmpty>No secret inputs for this run.</InspectorSectionEmpty>
      )}
    </InspectorSection>
  );
}

function secretInputScopeLabel(
  projectId: string | null | undefined,
  projectSlug: string | undefined,
): string {
  if (!projectId) return 'Workspace';
  return projectSlug ? `Project ${projectSlug}` : 'Project';
}

type ContextQuery = ReturnType<typeof useWorkflowJobExecutionContextQuery>;

function ExecutionInspectorTabs({
  selection,
  selectionRead,
  contextQuery,
  cost,
}: {
  selection: WorkflowExecutionInspectorSelection | undefined;
  selectionRead: WorkflowInspectorSelectionRead | undefined;
  contextQuery: ContextQuery;
  cost: ReactNode | undefined;
}) {
  const context = contextQuery.data;
  const execution = selection?.execution;
  const job = selection?.job;
  if (!execution || !job) {
    return (
      <InspectorTabs
        tabs={[
          {
            value: 'results',
            label: 'Results',
            content: <MissingExecution selectionRead={selectionRead} />,
          },
        ]}
      />
    );
  }

  const running = !isTerminalJobExecutionStatus(execution.status);
  const unavailable = context?.oversizedFields ?? [];
  const outputCount = context
    ? Object.keys(context.jobOutputs ?? {}).length +
      Object.keys(context.executionOutputs ?? {}).length
    : undefined;

  return (
    <InspectorTabs
      tabs={[
        {
          value: 'results',
          label: 'Results',
          count: outputCount,
          content: (
            <ExecutionQueryBoundary query={contextQuery}>
              <OutputSection
                title="Job outputs"
                outputs={context?.jobOutputs}
                running={running}
                unavailable={findUnavailable(unavailable, 'job_outputs')}
              />
              <OutputSection
                title="Execution outputs"
                outputs={context?.executionOutputs}
                running={running}
                unavailable={findUnavailable(unavailable, 'execution_outputs')}
              />
              <UnavailableAnnouncement
                fields={unavailable}
                owned={['job_outputs', 'execution_outputs']}
              />
            </ExecutionQueryBoundary>
          ),
        },
        {
          value: 'inputs',
          label: 'Inputs',
          count: context?.triggerEvents.length,
          content: (
            <ExecutionQueryBoundary query={contextQuery}>
              <ExecutionInputs
                events={context?.triggerEvents ?? []}
                unavailable={findUnavailable(unavailable, 'trigger_events')}
              />
              <UnavailableAnnouncement fields={unavailable} owned={['trigger_events']} />
            </ExecutionQueryBoundary>
          ),
        },
        {
          value: 'decisions',
          label: 'Decisions',
          content: (
            <ExecutionQueryBoundary query={contextQuery}>
              <ExecutionDecisions
                job={job}
                execution={execution}
                context={context}
                unavailable={unavailable}
              />
              <UnavailableAnnouncement
                fields={unavailable}
                owned={['condition', 'job_evaluation_trace', 'execution_evaluation_trace']}
              />
            </ExecutionQueryBoundary>
          ),
        },
        ...(cost ? [{value: 'cost', label: 'Cost', content: cost}] : []),
      ]}
    />
  );
}

function ExecutionDecisions({
  job,
  execution,
  context,
  unavailable,
}: {
  job: WorkflowRunOverviewJob;
  execution: WorkflowJobExecutionDetail;
  context: WorkflowJobExecutionContext | undefined;
  unavailable: readonly WorkflowDiagnosticUnavailableField[];
}) {
  const trace = [
    ...(context?.jobEvaluationTrace ?? []),
    ...(context?.executionEvaluationTrace ?? []),
  ];
  const {conditionTrace, executionNameTrace} = splitJobEvaluationTrace(trace);
  const conditionEntry = [...conditionTrace]
    .reverse()
    .find(
      (entry): entry is EvaluationTraceValueEntry =>
        !('dropped' in entry) && entry.field === 'job.if',
    );
  const otherEntries = conditionTrace.filter((entry) => entry !== conditionEntry);
  const statusReason = execution.statusReason ?? job.statusReason;
  const conditionUnavailable =
    findUnavailable(unavailable, 'condition') ??
    findUnavailable(unavailable, 'job_evaluation_trace');
  const executionNameUnavailable = findUnavailable(unavailable, 'execution_evaluation_trace');
  const condition = context?.condition ?? conditionEntry?.expression;

  if (
    !statusReason &&
    !condition &&
    trace.length === 0 &&
    !conditionUnavailable &&
    !executionNameUnavailable
  ) {
    return <InspectorNotice>No decisions were recorded.</InspectorNotice>;
  }

  return (
    <>
      {statusReason ? (
        <StatusReasonSection reason={statusReason} message={execution.statusReasonMessage} />
      ) : null}
      {condition || conditionUnavailable ? (
        <EvaluationSection
          title="Condition"
          expression={condition}
          entry={conditionEntry}
          unavailable={conditionUnavailable}
        />
      ) : null}
      <OtherEvaluationsSection entries={otherEntries} />
      {executionNameUnavailable ? (
        <EvaluationSection title="Execution name" unavailable={executionNameUnavailable} />
      ) : (
        executionNameTrace.map((entry, index) =>
          'dropped' in entry ? null : (
            <EvaluationSection
              // biome-ignore lint/suspicious/noArrayIndexKey: trace entries have no identity.
              key={`execution-name-${index}`}
              title="Execution name"
              expression={entry.expression}
              entry={entry}
            />
          ),
        )
      )}
    </>
  );
}

function StatusReasonSection({
  reason,
  message,
}: {
  reason: string;
  message: string | null | undefined;
}) {
  return (
    <InspectorSection title="Status reason" aside={<Badge size="2xs">{humanize(reason)}</Badge>}>
      {message ? (
        <InspectorSectionBody>
          <Text size="xs">{message}</Text>
        </InspectorSectionBody>
      ) : null}
    </InspectorSection>
  );
}

/** A decision: the outcome sits in the band, the expression and what it read below. */
function EvaluationSection({
  title,
  expression,
  entry,
  unavailable,
}: {
  title: string;
  expression?: string | undefined;
  entry?: EvaluationTraceValueEntry | undefined;
  unavailable?: WorkflowDiagnosticUnavailableField | undefined;
}) {
  return (
    <InspectorSection title={title} aside={entry ? <EvaluationOutcome entry={entry} /> : null}>
      {unavailable ? (
        <UnavailableNotice field={unavailable} />
      ) : (
        <PropertyList>
          <PropertyRow label="Expression" meta={<EvaluationFlags entry={entry} />}>
            {expression}
          </PropertyRow>
          {entry?.roots.length ? (
            <PropertyRow label="Reads">{entry.roots.join(', ')}</PropertyRow>
          ) : null}
        </PropertyList>
      )}
    </InspectorSection>
  );
}

function OtherEvaluationsSection({entries}: {entries: readonly EvaluationTraceEntry[]}) {
  if (entries.length === 0) return null;
  return (
    <InspectorSection title="Other evaluations" count={entries.length}>
      <EvaluationTraceList trace={entries} />
    </InspectorSection>
  );
}

function EvaluationOutcome({entry}: {entry: EvaluationTraceValueEntry}) {
  return (
    <Badge size="2xs" className="font-code">
      <EvaluationValue entry={entry} />
    </Badge>
  );
}

function MissingExecution({
  selectionRead,
}: {
  selectionRead: WorkflowInspectorSelectionRead | undefined;
}) {
  if (selectionRead?.status === 'error') {
    return (
      <InspectorNotice>
        <Callout role="alert" type="warning" variant="secondary">
          <CalloutContent>
            <CalloutTitle>Execution unavailable</CalloutTitle>
            <CalloutDescription className="flex items-center justify-between gap-inline">
              Could not load this execution.
              <Button type="button" variant="secondary" size="xs" onClick={selectionRead.onRetry}>
                Retry
              </Button>
            </CalloutDescription>
          </CalloutContent>
        </Callout>
      </InspectorNotice>
    );
  }
  if (selectionRead?.status !== 'pending') {
    return <InspectorNotice>No execution is selected.</InspectorNotice>;
  }
  return <InspectorLoading subject="execution" />;
}

function ExecutionQueryBoundary({query, children}: {query: ContextQuery; children: ReactNode}) {
  const context = query.data;
  return (
    <>
      {query.isPending ? <InspectorLoading subject="execution context" /> : null}
      {query.isError ? (
        <InspectorNotice>
          <ContextQueryError query={query} stale={context !== undefined} />
        </InspectorNotice>
      ) : null}
      {context ? children : null}
    </>
  );
}

function ContextQueryError({query, stale}: {query: ContextQuery; stale: boolean}) {
  return (
    <Callout role={stale ? 'status' : 'alert'} type="warning" variant="secondary">
      <CalloutContent>
        {stale ? null : <CalloutTitle>Execution context unavailable</CalloutTitle>}
        <CalloutDescription className="flex items-center justify-between gap-inline">
          <span>
            {stale
              ? 'Could not refresh execution context.'
              : 'We could not load this execution context.'}
          </span>
          <Button
            type="button"
            size="2xs"
            variant="secondary"
            isLoading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}

function OutputSection({
  title,
  outputs,
  running,
  unavailable,
}: {
  title: string;
  outputs: Record<string, unknown> | null | undefined;
  running: boolean;
  unavailable: WorkflowDiagnosticUnavailableField | undefined;
}) {
  const entries = outputs ? Object.entries(outputs) : [];
  return (
    <InspectorSection title={title} count={entries.length || undefined}>
      {outputSectionContent({outputs, entries, running, unavailable})}
    </InspectorSection>
  );
}

function outputSectionContent({
  outputs,
  entries,
  running,
  unavailable,
}: {
  outputs: Record<string, unknown> | null | undefined;
  entries: [string, unknown][];
  running: boolean;
  unavailable: WorkflowDiagnosticUnavailableField | undefined;
}): ReactNode {
  if (unavailable) return <UnavailableNotice field={unavailable} />;
  if (outputs === null || outputs === undefined) {
    return (
      <InspectorSectionEmpty>{running ? 'Not produced yet' : 'No outputs'}</InspectorSectionEmpty>
    );
  }
  if (entries.length === 0) return <InspectorSectionEmpty>No outputs</InspectorSectionEmpty>;
  return <JsonPropertyList value={outputs} copyLabel={(name) => `Copy output ${name}`} />;
}

function ExecutionInputs({
  events,
  unavailable,
}: {
  events: readonly WorkflowExecutionEvent[];
  unavailable: WorkflowDiagnosticUnavailableField | undefined;
}) {
  if (unavailable) {
    return (
      <InspectorSection title="Trigger events">
        <UnavailableNotice field={unavailable} />
      </InspectorSection>
    );
  }
  if (events.length === 0) {
    return (
      <InspectorSection title="Trigger events">
        <InspectorSectionEmpty>No recorded trigger events.</InspectorSectionEmpty>
      </InspectorSection>
    );
  }
  return events.map((event) => <TriggerEvent key={event.deliveryId} event={event} />);
}

function TriggerEvent({event}: {event: WorkflowExecutionEvent}) {
  const payload = serializeJsonValue(event.data);
  const fieldCount =
    typeof event.data === 'object' && event.data !== null ? Object.keys(event.data).length : 1;
  return (
    <InspectorSection
      title={
        <span className="font-code">
          {event.source} <span className="text-foreground-neutral-muted">{event.event}</span>
        </span>
      }
    >
      <PropertyList>
        <PropertyRow label="Delivery" copyValue={event.deliveryId} copyLabel="Copy delivery ID">
          {event.deliveryId}
        </PropertyRow>
        <PropertyRow label="Received">{event.receivedAt}</PropertyRow>
        {event.repository ? <PropertyRow label="Repository">{event.repository}</PropertyRow> : null}
        {event.ref ? <PropertyRow label="Reference">{event.ref}</PropertyRow> : null}
        <PropertyDisclosureRow
          label="Payload"
          toggleLabel={`Payload of ${event.source} ${event.event}`}
          summary={`${fieldCount} field${fieldCount === 1 ? '' : 's'}`}
          copyValue={payload}
          copyLabel={`Copy ${event.source} ${event.event} payload`}
        >
          <PropertyCode>{payload}</PropertyCode>
        </PropertyDisclosureRow>
      </PropertyList>
    </InspectorSection>
  );
}

function UnavailableNotice({field}: {field: WorkflowDiagnosticUnavailableField}) {
  return (
    <InspectorSectionBody>
      <Callout type="warning" variant="secondary">
        <CalloutContent>
          <CalloutTitle>{diagnosticFieldLabel(field.field)} unavailable</CalloutTitle>
          <CalloutDescription>
            The stored value is too large to display ({field.storedBytes.toLocaleString()} bytes).
          </CalloutDescription>
        </CalloutContent>
      </Callout>
    </InspectorSectionBody>
  );
}

function UnavailableAnnouncement({
  fields,
  owned,
}: {
  fields: readonly WorkflowDiagnosticUnavailableField[];
  owned: readonly WorkflowDiagnosticField[];
}) {
  const count = fields.filter((field) => owned.includes(field.field)).length;
  return count > 0 ? <DiagnosticUnavailableAnnouncement count={count} /> : null;
}

function findUnavailable(
  fields: readonly WorkflowDiagnosticUnavailableField[],
  field: WorkflowDiagnosticField,
): WorkflowDiagnosticUnavailableField | undefined {
  return fields.find((candidate) => candidate.field === field);
}

function InspectorLoading({subject}: {subject: string}) {
  return <InspectorNotice role="status">Loading {subject}…</InspectorNotice>;
}

function executionTime(
  execution: WorkflowJobExecutionDetail,
  kind: 'queue' | 'run',
): JobExecutionTime | undefined {
  const from = kind === 'queue' ? execution.queuedAt : execution.startedAt;
  const to = kind === 'queue' ? execution.startedAt : execution.finishedAt;
  if (!from) return undefined;
  return to ? {state: 'fixed', elapsed: elapsedDuration(from, to)} : {state: 'live', fromIso: from};
}

function elapsedDuration(from: string, to: string) {
  const milliseconds = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const seconds = Math.floor(milliseconds / 1000);
  return {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

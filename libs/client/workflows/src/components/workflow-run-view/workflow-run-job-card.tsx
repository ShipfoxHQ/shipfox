import {agentConfigIssueSchema, stepErrorReasonSchema} from '@shipfox/api-workflows-dto';
import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {
  Badge,
  EmptyState,
  Icon,
  RelativeTime,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useTimeTick,
} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {Fragment, useId} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {
  type Job,
  type JobExecution,
  type JobExecutionTime,
  type Step,
  type StepError,
  WORKFLOW_JOB_STATUSES,
  workflowRunTriggerDisplayLabel,
  workflowRunTriggerLabel,
} from '#core/workflow-run.js';
import {
  type WorkflowStepExpandedContext,
  WorkflowStepList,
  type WorkflowStepListEmptyState,
} from '../workflow-step-list/index.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';
import {JobExecutionSwitcher} from './job-execution-switcher.js';
import {formatJobExecutionTime, JobExecutionTimeText} from './job-execution-time-text.js';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';

const STATUS_BADGE_LABEL_WIDTH_CH = Math.max(
  ...WORKFLOW_JOB_STATUSES.map((status) => getWorkflowStatusVisual(status).label.length),
);

export function WorkflowRunJobCard({
  workspaceId,
  job,
  selectedJobExecution,
  selectedAttemptId,
  onSelectedJobExecutionChange,
  onSelectedAttemptChange,
  renderExpandedStep,
}: {
  workspaceId: string;
  job: Job;
  selectedJobExecution: JobExecution | undefined;
  selectedAttemptId: string | null | undefined;
  onSelectedJobExecutionChange: ((jobExecutionId: string | undefined) => void) | undefined;
  onSelectedAttemptChange: ((attemptId: string | undefined) => void) | undefined;
  renderExpandedStep?: ((context: WorkflowStepExpandedContext) => ReactNode) | undefined;
}) {
  const titleId = useId();
  const selectedExecutionStatus = selectedJobExecution?.status ?? job.status;
  const defaultRenderExpandedStep = ({
    step,
    stepId,
    attempt,
    attemptError,
    attemptStatus,
    carriedOver,
  }: WorkflowStepExpandedContext) =>
    carriedOver ? (
      <CarriedOverStepPanel />
    ) : (
      <StepAttemptDetailPanel
        workspaceId={workspaceId}
        step={step}
        stepId={stepId}
        attempt={attempt}
        attemptError={attemptError}
        attemptStatus={attemptStatus}
      />
    );

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-components-base"
    >
      <div className="grid min-h-52 min-w-0 grid-cols-1 gap-y-4 px-16 py-12">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-10">
          {job.mode === 'listening' &&
          job.jobExecutions.length > 0 &&
          onSelectedJobExecutionChange ? (
            <>
              <Text as="h2" id={titleId} size="sm" bold className="sr-only">
                {job.displayName}
              </Text>
              <div className="flex min-w-0 items-center gap-8">
                <JobStatusBadge status={selectedExecutionStatus} />
                <JobExecutionSwitcher
                  job={job}
                  selectedJobExecution={selectedJobExecution?.id ?? null}
                  onSelectedJobExecutionChange={onSelectedJobExecutionChange}
                  variant="title"
                />
              </div>
            </>
          ) : (
            <div className="flex min-w-0 items-center gap-8">
              <JobStatusBadge status={selectedExecutionStatus} />
              <Text
                as="h2"
                id={titleId}
                size="sm"
                bold
                className="min-w-0 truncate text-foreground-neutral-base"
              >
                {job.displayName}
              </Text>
            </div>
          )}
        </div>
        <JobExecutionMetadata execution={selectedJobExecution} />
      </div>
      <div className="min-h-0 border-t border-border-neutral-strong">
        {selectedJobExecution ? (
          <WorkflowStepList
            job={job}
            jobExecution={selectedJobExecution}
            selectedAttemptId={selectedAttemptId}
            onSelectedAttemptChange={onSelectedAttemptChange}
            autoSelectActiveAttempt
            emptyState={emptyStateForJob(job, selectedJobExecution)}
            showHeader={false}
            className="rounded-none border-0 bg-transparent"
            renderExpandedStep={renderExpandedStep ?? defaultRenderExpandedStep}
          />
        ) : (
          <JobExecutionEmptyState job={job} />
        )}
      </div>
    </section>
  );
}

function JobStatusBadge({status}: {status: Job['status'] | JobExecution['status']}) {
  const visual = getWorkflowStatusVisual(status);

  return (
    <Badge variant={visual.badge} size="xs">
      <span className="text-center" style={{width: `${STATUS_BADGE_LABEL_WIDTH_CH}ch`}}>
        {visual.label}
      </span>
    </Badge>
  );
}

function JobExecutionEmptyState({job}: {job: Job}) {
  const emptyState = emptyStateForMissingExecution(job);

  return (
    <EmptyState
      className="min-h-120 px-16 py-20"
      icon="componentLine"
      title={emptyState.title}
      description={emptyState.description}
      variant="compact"
    />
  );
}

function JobExecutionMetadata({execution}: {execution: JobExecution | undefined}) {
  if (!execution) return null;

  const queueTime = execution.queueTime;
  const runTime = execution.runTime;
  const executionStartedAt = execution.startedAt ?? execution.queuedAt ?? execution.createdAt;
  const items = [
    execution.triggerEvents.length > 0 ? {key: 'trigger', kind: 'trigger' as const} : null,
    {key: 'started', kind: 'started' as const, value: executionStartedAt},
    queueTime
      ? {key: 'queue', icon: 'hourglassLine' as const, kind: 'queue' as const, time: queueTime}
      : null,
    runTime ? {key: 'run', icon: 'timerLine' as const, kind: 'run' as const, time: runTime} : null,
  ].filter((item) => item !== null);

  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-12 overflow-hidden text-foreground-neutral-muted">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <MetadataSeparator /> : null}
          {item.kind === 'started' ? (
            <RelativeTime
              value={item.value}
              className="shrink-0 whitespace-nowrap text-xs leading-20 text-foreground-neutral-muted"
            />
          ) : item.kind === 'trigger' ? (
            <JobExecutionTriggerMetadata execution={execution} />
          ) : (
            <JobExecutionMetadataItem icon={item.icon} kind={item.kind} time={item.time} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

function JobExecutionTriggerMetadata({execution}: {execution: JobExecution}) {
  const triggerEvent = execution.triggerEvents[0];
  if (!triggerEvent) return null;

  const triggerLabel = workflowRunTriggerLabel({
    triggerSource: triggerEvent.source,
    triggerEvent: triggerEvent.event,
  });
  const triggerDisplayLabel = workflowRunTriggerDisplayLabel({
    triggerSource: triggerEvent.source,
    triggerEvent: triggerEvent.event,
  });
  const triggerCount = execution.triggerEvents.length;
  const countLabel = triggerCount > 1 ? ` (${triggerCount})` : '';
  const tooltip = triggerCount > 1 ? `${triggerLabel} (${triggerCount} events)` : triggerLabel;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltip}
          className="inline-flex min-w-0 max-w-full cursor-default items-center gap-4 rounded-4 border-0 bg-transparent p-0 text-left text-foreground-neutral-muted outline-none focus-visible:shadow-border-interactive-with-active"
        >
          <TriggerSourceIcon
            provider={triggerEvent.source}
            source={triggerEvent.source}
            aria-hidden="true"
            className="size-12 shrink-0"
          />
          <Text as="span" size="xs" className="min-w-0 truncate">
            {triggerDisplayLabel}
            {countLabel}
          </Text>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs" className="block max-w-[360px] break-words">
          {tooltip}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

function JobExecutionMetadataItem({
  icon,
  kind,
  time,
}: {
  icon: 'hourglassLine' | 'timerLine';
  kind: 'queue' | 'run';
  time: JobExecutionTime;
}) {
  useTimeTick();

  const tooltip = `${jobExecutionTimeVerb(kind, time)} for ${formatJobExecutionTime(time)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltip}
          className="inline-flex min-w-0 cursor-default items-center gap-4 rounded-4 border-0 bg-transparent p-0 text-foreground-neutral-muted outline-none focus-visible:shadow-border-interactive-with-active"
        >
          <Icon name={icon} className="size-12 shrink-0" aria-hidden="true" />
          <span className="shrink-0 text-xs leading-20 text-foreground-neutral-muted tabular-nums">
            <JobExecutionTimeText time={time} />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs">
          {tooltip}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

function jobExecutionTimeVerb(kind: 'queue' | 'run', time: JobExecutionTime): string {
  if (kind === 'queue') return time.state === 'live' ? 'Queuing' : 'Queued';
  return time.state === 'live' ? 'Running' : 'Ran';
}

function MetadataSeparator() {
  return <span aria-hidden="true" className="h-12 w-px shrink-0 bg-border-neutral-strong" />;
}

function StepAttemptDetailPanel({
  workspaceId,
  step,
  stepId,
  attempt,
  attemptError,
  attemptStatus,
}: {
  workspaceId: string;
  step: Step;
  stepId: string;
  attempt: number;
  attemptError: Record<string, unknown> | null;
  attemptStatus: string;
}) {
  const selectedAttemptError = toSelectedAttemptError(step, attemptError) ?? step.error;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      {isAgentConfigFailure(step, selectedAttemptError) ? (
        <AgentConfigFailureCallout
          workspaceId={workspaceId}
          config={null}
          error={selectedAttemptError}
        />
      ) : null}
      <StepAttemptLogPanel stepId={stepId} attempt={attempt} attemptStatus={attemptStatus} />
    </div>
  );
}

function toSelectedAttemptError(
  step: Step,
  error: Record<string, unknown> | null,
): StepError | null {
  if (error === null) return null;

  const reason = stepErrorReasonSchema.safeParse(error.reason);
  const agentConfigIssue = agentConfigIssueSchema.safeParse(
    error.agentConfigIssue ?? error.agent_config_issue,
  );
  const exitCode = error.exitCode ?? error.exit_code;
  const parsedReason = reason.success
    ? reason.data
    : agentConfigIssue.success
      ? 'agent_config_invalid'
      : undefined;

  if (parsedReason === undefined) return null;

  return {
    message: typeof error.message === 'string' ? error.message : '',
    exitCode: exitCode === null || typeof exitCode === 'number' ? exitCode : null,
    signal: typeof error.signal === 'string' ? error.signal : undefined,
    reason: parsedReason,
    agentConfigIssue: agentConfigIssue.success ? agentConfigIssue.data : undefined,
    category: step.type === 'setup' ? 'setup' : 'user',
  };
}

function isAgentConfigFailure(step: Step, error: StepError | null): boolean {
  return step.type === 'agent' && error?.reason === 'agent_config_invalid';
}

function emptyStateForJob(
  job: Job,
  jobExecution: JobExecution,
): WorkflowStepListEmptyState | undefined {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  if (job.status === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'Steps will appear here once the job starts.',
      status: 'pending',
    };
  }

  if (job.status === 'running') {
    return {
      title: 'Waiting for the first step',
      description: 'This job is running, but no steps have started yet.',
      status: 'running',
    };
  }

  if (job.status === 'skipped') {
    return {
      title: 'This job was skipped',
      description: skippedJobDescription(job.statusReason),
      status: 'skipped',
    };
  }

  if (job.status === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job was cancelled before any step started.',
      status: 'cancelled',
    };
  }

  if (job.status === 'succeeded' || job.status === 'failed') {
    return {
      title: 'No steps recorded',
      description: `Execution #${jobExecution.sequence} finished without recorded steps.`,
      status: job.status,
    };
  }

  return undefined;
}

function emptyStateForMissingExecution(job: Job): WorkflowStepListEmptyState {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'listening') {
    return {
      title: 'Waiting for trigger events',
      description: 'Matching trigger events will create job executions here.',
      status: 'running',
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'resolved') {
    return {
      title: 'Listener resolved without executions',
      description: 'No matching trigger event created a job execution before the listener stopped.',
      status: job.status,
    };
  }

  if (job.status === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'No execution has been created for this job yet.',
      status: 'pending',
    };
  }

  if (job.status === 'skipped') {
    return {
      title: 'This job was skipped',
      description: skippedJobDescription(job.statusReason),
      status: 'skipped',
    };
  }

  if (job.status === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job was cancelled before an execution was created.',
      status: 'cancelled',
    };
  }

  return {
    title: 'Execution details unavailable',
    description: 'This job finished, but no job execution record is available.',
    status: job.status,
  };
}

function CarriedOverStepPanel() {
  return (
    <EmptyState
      className="min-h-120 rounded-8 border border-border-neutral-base bg-background-components-base px-16 py-20"
      icon="componentLine"
      title="Carried over from a previous attempt"
      description="Not executed in this run."
      variant="compact"
    />
  );
}

function skippedJobDescription(reason: Job['statusReason']): string {
  switch (reason) {
    case 'dependency_not_completed':
      return 'A required job did not complete, so this job was skipped.';
    case 'condition_false':
      return 'The job condition did not match, so this job was skipped.';
    case 'user_cancelled':
    case 'run_cancelled':
    case 'timed_out':
    case 'runner_lost':
    case 'step_failed':
    case 'unknown':
    case null:
      return 'This job did not start.';
  }
}

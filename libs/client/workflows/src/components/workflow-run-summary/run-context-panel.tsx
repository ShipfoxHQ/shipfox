import {type RunUsage, RunUsageBreakdown} from '@shipfox/client-usage';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shipfox/react-ui/sheet';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useState} from 'react';
import type {WorkflowRunAttemptReference, WorkflowRunConcurrency} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {useWorkflowRunAttemptReferenceQueries} from '#hooks/api/workflow-run-overview.js';
import {DetailsTabs} from '../details-tabs.js';
import {WorkflowRunDurationLabel} from '../workflow-run-duration-label.js';
import {getWorkflowStatusVisual} from '../workflow-status/status-visuals.js';
import type {WorkflowRunSummaryRun} from './workflow-run-summary.js';

export function RunContextPanel({
  run,
  usage,
  workspaceSlug,
  projectSlug,
}: {
  run: WorkflowRunSummaryRun;
  usage: RunUsage | undefined;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const hasStarted =
    'hasStartedJobExecution' in run ? run.hasStartedJobExecution : run.jobs.hasStartedJobExecution;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Inspect run details"
              className="flex size-24 shrink-0 items-center justify-center rounded-4 text-foreground-neutral-muted hover:text-foreground-neutral-base focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
            >
              <Icon name="informationLine" size={14} aria-hidden="true" />
            </button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Inspect run details</TooltipContent>
      </Tooltip>
      <SheetContent className="w-full sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{run.name}</SheetTitle>
          <SheetDescription>
            Run {run.number ?? run.id} · Attempt #{run.runAttempt.attempt}
          </SheetDescription>
        </SheetHeader>
        <DetailsTabs cost={usage ? <RunUsageBreakdown runId={run.id} usage={usage} /> : undefined}>
          <SheetBody>
            <dl className="w-full text-xs text-foreground-neutral-subtle">
              <div className="flex justify-between gap-inline py-row">
                <dt>Status</dt>
                <dd>{getWorkflowStatusVisual(run.runAttempt.status).label}</dd>
              </div>
              <div className="flex justify-between gap-inline py-row">
                <dt>Trigger</dt>
                <dd className="min-w-0 break-words text-right">{run.triggerDisplayLabel || '—'}</dd>
              </div>
              {run.runAttempt.displayDuration ? (
                <div className="flex justify-between gap-inline py-row">
                  <dt>Duration</dt>
                  <dd>
                    <WorkflowRunDurationLabel
                      duration={run.runAttempt.displayDuration}
                      hasStarted={hasStarted}
                    />
                  </dd>
                </div>
              ) : null}
              {open && run.runAttempt.concurrency ? (
                <WorkflowRunConcurrencyRows
                  concurrency={run.runAttempt.concurrency}
                  workspaceSlug={workspaceSlug}
                  projectSlug={projectSlug}
                />
              ) : null}
            </dl>
          </SheetBody>
        </DetailsTabs>
      </SheetContent>
    </Sheet>
  );
}

function WorkflowRunConcurrencyRows({
  concurrency,
  workspaceSlug,
  projectSlug,
}: {
  concurrency: WorkflowRunConcurrency;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  const relatedQueries = useWorkflowRunAttemptReferenceQueries(concurrency.affectedAttempts);
  const relation = concurrencyRelation(concurrency);

  return (
    <>
      <div className="border-t border-border-neutral-base pt-row">
        <dt>
          <Text as="span" size="xs" bold className="text-foreground-neutral-base">
            Concurrency
          </Text>
        </dt>
      </div>
      <RunDetailRow label="Group">
        <Code as="span" variant="label" className="max-w-[360px] break-words text-right">
          {concurrency.displayGroup}
        </Code>
      </RunDetailRow>
      <RunDetailRow label="Scope">
        {concurrency.scope === 'project' ? 'Project · shared across workflows' : 'Workflow'}
      </RunDetailRow>
      <RunDetailRow label="State">{concurrencyStateLabel(concurrency.state)}</RunDetailRow>
      <RunDetailRow label="Policy">
        {concurrency.cancelInProgress ? 'Cancel the running holder' : 'Keep the running holder'}
      </RunDetailRow>
      {relation ? (
        <RunDetailRow label={relation}>
          <WorkflowRunReferences
            queries={relatedQueries}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
          />
        </RunDetailRow>
      ) : null}
    </>
  );
}

function RunDetailRow({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 justify-between gap-cluster py-row">
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function WorkflowRunReferences({
  queries,
  workspaceSlug,
  projectSlug,
}: {
  queries: ReturnType<typeof useWorkflowRunAttemptReferenceQueries>;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  if (queries.length === 0) return 'Related run unavailable';

  return (
    <span className="flex min-w-0 flex-col items-end gap-tight">
      {queries.map((query, index) => {
        const key = query.data?.workflowRunAttemptId ?? `related-${index}`;
        if (query.isPending) {
          return (
            <Text key={key} as="span" size="xs" className="text-foreground-neutral-muted">
              Loading related run...
            </Text>
          );
        }
        if (query.isError || !query.data) {
          return <span key={key}>Related run unavailable</span>;
        }
        return (
          <WorkflowRunReferenceLink
            key={key}
            reference={query.data}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
          />
        );
      })}
    </span>
  );
}

function WorkflowRunReferenceLink({
  reference,
  workspaceSlug,
  projectSlug,
}: {
  reference: WorkflowRunAttemptReference;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  const label = `${reference.workflowName} run${
    reference.number === null ? '' : ` #${reference.number}`
  }, attempt ${reference.attempt}`;
  if (!workspaceSlug || !projectSlug) return label;

  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{workspaceSlug, projectSlug, workflowRunId: reference.workflowRunId}}
      search={
        ((previous: Record<string, unknown>) => ({
          ...withoutWorkflowRunSelectionSearch(previous),
          runAttempt: reference.attempt,
        })) as never
      }
      className="break-words text-foreground-highlight-interactive outline-none hover:underline focus-visible:shadow-button-neutral-focus"
    >
      {label}
    </Link>
  );
}

function concurrencyRelation(concurrency: WorkflowRunConcurrency): string | null {
  if (concurrency.state === 'waiting') return 'Held by';
  if (concurrency.state === 'superseded') return 'Superseded by';
  return null;
}

function concurrencyStateLabel(state: WorkflowRunConcurrency['state']): string {
  switch (state) {
    case 'acquired':
      return 'Acquired';
    case 'waiting':
      return 'Waiting';
    case 'superseded':
      return 'Superseded';
    case 'released':
      return 'Released';
  }

  const exhaustive: never = state;
  return exhaustive;
}

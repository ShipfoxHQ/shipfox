import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  type BadgeVariant,
  cn,
  Dot,
  EmptyState,
  Icon,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {useEffect, useId, useMemo, useState} from 'react';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {isWorkflowStatus, type WorkflowJob} from '#core/workflow-run.js';
import {
  buildWorkflowStepListModel,
  humanizeStatus,
  type WorkflowStepAttemptModel,
  type WorkflowStepListEntryModel,
  type WorkflowStepListModel,
} from './workflow-step-list-model.js';

export interface WorkflowStepExpandedContext {
  stepId: string;
  attempt: number;
  attemptId: string;
  attemptStatus: string;
  carriedOver: boolean;
}

export interface WorkflowStepListEmptyState {
  title: string;
  description: string;
  status?: WorkflowJob['status'] | undefined;
}

export interface WorkflowStepListProps {
  job: WorkflowJob;
  selectedAttemptId?: string | null | undefined;
  defaultSelectedAttemptId?: string | undefined;
  onSelectedAttemptChange?: ((attemptId: string | undefined) => void) | undefined;
  autoSelectActiveAttempt?: boolean | undefined;
  emptyState?: WorkflowStepListEmptyState | undefined;
  renderExpandedStep?: ((context: WorkflowStepExpandedContext) => ReactNode) | undefined;
  className?: string | undefined;
}

export function WorkflowStepList({
  job,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  autoSelectActiveAttempt = false,
  emptyState,
  renderExpandedStep,
  className,
}: WorkflowStepListProps) {
  const model = useMemo(() => buildWorkflowStepListModel({job}), [job]);

  return (
    <WorkflowStepListContent
      key={model.jobId}
      model={model}
      selectedAttemptId={selectedAttemptId}
      defaultSelectedAttemptId={defaultSelectedAttemptId}
      onSelectedAttemptChange={onSelectedAttemptChange}
      autoSelectActiveAttempt={autoSelectActiveAttempt}
      emptyState={emptyState}
      renderExpandedStep={renderExpandedStep}
      className={className}
    />
  );
}

function WorkflowStepListContent({
  model,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  autoSelectActiveAttempt,
  emptyState,
  renderExpandedStep,
  className,
}: Omit<WorkflowStepListProps, 'job'> & {model: WorkflowStepListModel}) {
  const titleId = useId();
  const [localSelectedAttemptIds, setLocalSelectedAttemptIds] = useState<string[]>(
    defaultSelectedAttemptId ? [defaultSelectedAttemptId] : [],
  );
  const [userSelectedAttempt, setUserSelectedAttempt] = useState(false);
  const autoSelectedAttemptIds =
    autoSelectActiveAttempt && !userSelectedAttempt && model.activeEntryId
      ? [model.activeEntryId]
      : [];
  // `undefined` leaves selection uncontrolled; `null` is a controlled collapsed state.
  const selectedAttemptIds =
    selectedAttemptId !== undefined
      ? selectedAttemptId
        ? [selectedAttemptId]
        : []
      : localSelectedAttemptIds.length > 0
        ? localSelectedAttemptIds
        : autoSelectedAttemptIds;
  const hasExpandedContent = renderExpandedStep !== undefined;

  useEffect(() => {
    setLocalSelectedAttemptIds(defaultSelectedAttemptId ? [defaultSelectedAttemptId] : []);
    setUserSelectedAttempt(false);
  }, [defaultSelectedAttemptId]);

  function selectAttempt(nextAttemptIds: string[]) {
    const nextAttemptId = nextSelectedAttemptId(selectedAttemptIds, nextAttemptIds);
    setUserSelectedAttempt(true);
    setLocalSelectedAttemptIds(nextAttemptIds);
    onSelectedAttemptChange?.(nextAttemptId);
  }

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-components-base',
        className,
      )}
    >
      <div className="flex min-h-40 items-center border-b border-border-neutral-base px-16 py-8">
        <Text as="h2" id={titleId} size="sm" bold className="text-foreground-neutral-base">
          {model.jobName}
        </Text>
      </div>

      {model.entries.length === 0 ? (
        <WorkflowStepListEmptyStateView emptyState={emptyState} />
      ) : (
        <Accordion
          type="multiple"
          value={selectedAttemptIds}
          onValueChange={selectAttempt}
          className="min-h-0 overflow-auto"
          asChild
        >
          <ol>
            {model.entries.map((entry) => {
              const selected = selectedAttemptIds.includes(entry.id);
              return (
                <WorkflowStepRow
                  key={entry.id}
                  entry={entry}
                  selected={selected}
                  hasExpandedContent={hasExpandedContent}
                  onSelect={() => {
                    selectAttempt(
                      hasExpandedContent
                        ? toggleAttemptId(selectedAttemptIds, entry.id)
                        : selected
                          ? []
                          : [entry.id],
                    );
                  }}
                  expandedContent={
                    selected
                      ? renderExpandedStep?.({
                          stepId: entry.step.id,
                          attempt: entry.attempt,
                          attemptId: entry.id,
                          attemptStatus: entry.statusVisual.kind,
                          carriedOver: entry.carriedOver,
                        })
                      : null
                  }
                />
              );
            })}
          </ol>
        </Accordion>
      )}
    </section>
  );
}

function WorkflowStepListEmptyStateView({
  emptyState = {
    title: 'No steps recorded',
    description: 'This job has not recorded any steps.',
  },
}: {
  emptyState?: WorkflowStepListEmptyState | undefined;
}) {
  if (!emptyState.status) {
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

  return (
    <div className="flex min-h-120 flex-col items-center justify-center gap-10 px-16 py-20">
      <WorkflowStepListEmptyStateIcon status={emptyState.status} />
      <div className="text-center">
        <Text size="sm" className="text-foreground-neutral-subtle">
          {emptyState.title}
        </Text>
        <Text size="xs" className="text-foreground-neutral-muted">
          {emptyState.description}
        </Text>
      </div>
    </div>
  );
}

function WorkflowStepListEmptyStateIcon({status}: {status: WorkflowJob['status']}) {
  if (status !== 'running') {
    return (
      <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-8">
        <WorkflowStatusIcon status={status} size={20} tooltip={false} />
      </div>
    );
  }

  return (
    <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-8 text-foreground-neutral-muted">
      <Icon name="timerLine" size={18} aria-hidden="true" />
    </div>
  );
}

function WorkflowStepRow({
  entry,
  selected,
  hasExpandedContent,
  onSelect,
  expandedContent,
}: {
  entry: WorkflowStepListEntryModel;
  selected: boolean;
  hasExpandedContent: boolean;
  onSelect: () => void;
  expandedContent: ReactNode;
}) {
  const shouldShowLabelTooltip = entry.step.label.length > 32;
  const rowContent = (
    <>
      <Icon
        name="chevronRight"
        aria-hidden="true"
        className={cn(
          'size-14 shrink-0 text-foreground-neutral-muted transition-transform',
          selected && 'rotate-90',
        )}
      />
      <WorkflowStepStatusIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-8">
          <Text size="sm" bold className="truncate text-foreground-neutral-base">
            {entry.step.label}
          </Text>
          {entry.step.attempts.length > 1 ? <WorkflowAttemptChip attempt={entry} /> : null}
          {entry.carriedOver ? <CarriedOverBadge /> : null}
        </div>
      </div>
    </>
  );
  const rowClasses = cn(
    'group grid min-h-44 w-full grid-cols-[14px_14px_minmax(0,1fr)] items-center gap-x-8 px-12 py-6 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
    selected && 'bg-background-components-hover',
    entry.carriedOver && 'opacity-[0.55]',
  );
  const button = hasExpandedContent ? (
    <AccordionTrigger
      showIcon={false}
      aria-label={entryAccessibleLabel(entry)}
      className={rowClasses}
    >
      {rowContent}
    </AccordionTrigger>
  ) : (
    <button
      type="button"
      aria-expanded={false}
      aria-label={entryAccessibleLabel(entry)}
      onClick={onSelect}
      className={rowClasses}
    >
      {rowContent}
    </button>
  );
  const row = (
    <>
      {shouldShowLabelTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <span className="block max-w-320 break-words">{entry.step.label}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      {selected && expandedContent ? (
        <AccordionContent className="border-t border-border-neutral-base bg-background-neutral-base px-12 py-12">
          <div className="grid grid-cols-[14px_14px_minmax(0,1fr)] gap-x-8">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <div className="min-w-0">{expandedContent}</div>
          </div>
        </AccordionContent>
      ) : null}
    </>
  );

  if (hasExpandedContent) {
    return (
      <AccordionItem value={entry.id} asChild>
        <li>{row}</li>
      </AccordionItem>
    );
  }

  return <li className="border-b border-border-neutral-base last:border-b-0">{row}</li>;
}

function CarriedOverBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          <Badge variant="neutral" size="2xs">
            reused
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Carried over from a previous attempt; did not run in this attempt.
      </TooltipContent>
    </Tooltip>
  );
}

function toggleAttemptId(selectedAttemptIds: readonly string[], attemptId: string): string[] {
  if (selectedAttemptIds.includes(attemptId)) {
    return selectedAttemptIds.filter((selectedAttemptId) => selectedAttemptId !== attemptId);
  }
  return [...selectedAttemptIds, attemptId];
}

function nextSelectedAttemptId(
  selectedAttemptIds: readonly string[],
  nextAttemptIds: readonly string[],
): string | undefined {
  if (nextAttemptIds.length === 0) return undefined;

  const openedAttemptId = nextAttemptIds.find(
    (attemptId) => !selectedAttemptIds.includes(attemptId),
  );
  return openedAttemptId ?? nextAttemptIds.at(-1);
}

function WorkflowStepStatusIcon({entry}: {entry: WorkflowStepListEntryModel}) {
  if (isWorkflowStatus(entry.statusVisual.kind)) {
    return (
      <WorkflowStatusIcon
        status={entry.statusVisual.kind}
        ripple={entry.statusVisual.ripple}
        size={14}
      />
    );
  }

  return (
    <span role="img" aria-label={entry.statusVisual.label} className="inline-flex shrink-0">
      <Dot
        variant={entry.statusVisual.dot}
        ripple={entry.statusVisual.ripple}
        className="size-12 shrink-0"
      />
    </span>
  );
}

const attemptChipClasses: Record<NonNullable<BadgeVariant>, string> = {
  neutral: 'bg-tag-neutral-bg border-tag-neutral-border',
  info: 'bg-tag-blue-bg border-tag-blue-border',
  feature: 'bg-tag-purple-bg border-tag-purple-border',
  success: 'bg-tag-success-bg border-tag-success-border',
  warning: 'bg-tag-warning-bg border-tag-warning-border',
  error: 'bg-tag-error-bg border-tag-error-border',
};

function WorkflowAttemptChip({attempt}: {attempt: WorkflowStepAttemptModel}) {
  return (
    <div className="flex shrink-0 items-center gap-4" aria-hidden="true">
      <span
        className={cn(
          'inline-flex h-18 min-w-24 items-center justify-center rounded-4 border px-5 font-code text-xs leading-16 text-foreground-neutral-base',
          attemptChipClasses[attempt.statusVisual.badge ?? 'neutral'],
        )}
      >
        #{attempt.attempt}
      </span>
    </div>
  );
}

function entryAccessibleLabel(entry: WorkflowStepListEntryModel): string {
  const parts = [entry.step.label, entry.statusVisual.label, `attempt ${entry.attempt}`];
  if (entry.step.error?.category) parts.push(humanizeStatus(entry.step.error.category));
  return parts.join(', ');
}

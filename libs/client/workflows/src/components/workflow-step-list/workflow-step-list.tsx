import {
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
import type {WorkflowJob} from '#core/workflow-run.js';
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
}

export interface WorkflowStepListProps {
  job: WorkflowJob;
  selectedAttemptId?: string | undefined;
  defaultSelectedAttemptId?: string | undefined;
  onSelectedAttemptChange?: ((attemptId: string | undefined) => void) | undefined;
  autoSelectActiveAttempt?: boolean | undefined;
  renderExpandedStep?: ((context: WorkflowStepExpandedContext) => ReactNode) | undefined;
  className?: string | undefined;
}

export function WorkflowStepList({
  job,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  autoSelectActiveAttempt = false,
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
  renderExpandedStep,
  className,
}: Omit<WorkflowStepListProps, 'job'> & {model: WorkflowStepListModel}) {
  const titleId = useId();
  const [localSelectedAttemptId, setLocalSelectedAttemptId] = useState<string | undefined>(
    defaultSelectedAttemptId,
  );
  const [userSelectedAttempt, setUserSelectedAttempt] = useState(false);
  const autoSelectedAttemptId =
    autoSelectActiveAttempt && !userSelectedAttempt ? model.activeEntryId : undefined;
  const selected = selectedAttemptId ?? localSelectedAttemptId ?? autoSelectedAttemptId;

  useEffect(() => {
    setLocalSelectedAttemptId(defaultSelectedAttemptId);
    setUserSelectedAttempt(false);
  }, [defaultSelectedAttemptId]);

  function selectAttempt(attemptId: string) {
    const nextAttemptId = attemptId === selected ? undefined : attemptId;
    setUserSelectedAttempt(true);
    setLocalSelectedAttemptId(nextAttemptId);
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
      <div className="flex min-h-52 flex-col justify-center gap-2 border-b border-border-neutral-base px-16 py-8">
        <Text as="h2" id={titleId} size="sm" bold className="text-foreground-neutral-base">
          Step attempts
        </Text>
        <Text size="xs" className="min-w-0 truncate text-foreground-neutral-subtle">
          {model.jobName}
        </Text>
      </div>

      {model.entries.length === 0 ? (
        <EmptyState
          className="min-h-120 px-16 py-20"
          icon="componentLine"
          title="No step attempts yet"
          description="This job has not recorded step attempts."
          variant="compact"
        />
      ) : (
        <ol className="min-h-0 divide-y divide-border-neutral-base overflow-auto">
          {model.entries.map((entry) => (
            <WorkflowStepRow
              key={entry.id}
              entry={entry}
              selected={entry.id === selected}
              hasExpandedContent={renderExpandedStep !== undefined}
              onSelect={() => selectAttempt(entry.id)}
              expandedContent={
                entry.id === selected
                  ? renderExpandedStep?.({
                      stepId: entry.step.id,
                      attempt: entry.attempt,
                      attemptId: entry.id,
                      attemptStatus: entry.statusVisual.kind,
                    })
                  : null
              }
            />
          ))}
        </ol>
      )}
    </section>
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
  const buttonId = useId();
  const panelId = useId();
  const button = (
    <button
      id={buttonId}
      type="button"
      aria-expanded={selected && hasExpandedContent}
      {...(hasExpandedContent ? {'aria-controls': panelId} : {})}
      aria-label={entryAccessibleLabel(entry)}
      onClick={onSelect}
      className={cn(
        'group flex min-h-56 w-full items-center gap-10 px-12 py-8 text-left transition-colors hover:bg-background-components-hover focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
        selected && 'bg-background-components-hover',
      )}
    >
      <Icon
        name="chevronRight"
        aria-hidden="true"
        className={cn(
          'size-14 shrink-0 text-foreground-neutral-muted transition-transform',
          selected && 'rotate-90',
        )}
      />
      <Text size="xs" className="w-20 shrink-0 text-right font-code text-foreground-neutral-muted">
        {entry.step.index}
      </Text>
      <Dot
        variant={entry.statusVisual.dot}
        ripple={entry.statusVisual.ripple}
        className="size-8 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-8">
          <Text size="sm" bold className="truncate text-foreground-neutral-base">
            {entry.step.label}
          </Text>
          {entry.step.attempts.length > 1 ? <WorkflowAttemptChip attempt={entry} /> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2">
          <Text size="xs" className="text-foreground-neutral-subtle">
            {entry.statusVisual.label}
          </Text>
        </div>
      </div>
    </button>
  );

  return (
    <li>
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
        <section
          id={panelId}
          aria-labelledby={buttonId}
          className="border-t border-border-neutral-base bg-background-neutral-base px-44 py-12"
        >
          {expandedContent}
        </section>
      ) : null}
    </li>
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
  const parts = [
    `${entry.step.index}. ${entry.step.label}`,
    entry.statusVisual.label,
    `attempt ${entry.attempt}`,
  ];
  if (entry.step.error?.category) parts.push(humanizeStatus(entry.step.error.category));
  return parts.join(', ');
}

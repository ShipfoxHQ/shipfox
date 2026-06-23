import type {RunJobDetailDto} from '@shipfox/api-workflows-dto';
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
import {useId, useMemo, useState} from 'react';
import {
  buildWorkflowStepListModel,
  humanizeStatus,
  type WorkflowStepAttemptModel,
  type WorkflowStepListEntryModel,
} from './workflow-step-list-model.js';

export interface WorkflowStepListProps {
  job: RunJobDetailDto;
  selectedStepId?: string | undefined;
  defaultSelectedStepId?: string | undefined;
  onSelectedStepChange?: ((stepId: string | undefined) => void) | undefined;
  renderExpandedStep?: ((context: {stepId: string}) => ReactNode) | undefined;
  className?: string | undefined;
}

export function WorkflowStepList({
  job,
  selectedStepId,
  defaultSelectedStepId,
  onSelectedStepChange,
  renderExpandedStep,
  className,
}: WorkflowStepListProps) {
  const titleId = useId();
  const model = useMemo(() => buildWorkflowStepListModel({job}), [job]);
  const [localSelectedStepId, setLocalSelectedStepId] = useState<string | undefined>(
    defaultSelectedStepId,
  );
  const selected = selectedStepId ?? localSelectedStepId;

  function selectStep(stepId: string) {
    const nextStepId = stepId === selected ? undefined : stepId;
    setLocalSelectedStepId(nextStepId);
    onSelectedStepChange?.(nextStepId);
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
              onSelect={() => selectStep(entry.id)}
              expandedContent={
                entry.id === selected ? renderExpandedStep?.({stepId: entry.stepId}) : null
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
  const shouldShowLabelTooltip = entry.label.length > 32;
  const button = (
    <button
      type="button"
      aria-expanded={selected && hasExpandedContent}
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
        {entry.index}
      </Text>
      <Dot variant={entry.status.dot} ripple={entry.status.ripple} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-8">
          <Text size="sm" bold className="truncate text-foreground-neutral-base">
            {entry.label}
          </Text>
          {entry.attemptCount > 1 ? <WorkflowAttemptChip attempt={entry.attempt} /> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2">
          <Text size="xs" className="text-foreground-neutral-subtle">
            {entry.status.label}
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
            <span className="block max-w-320 break-words">{entry.label}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      {selected && expandedContent ? (
        <div className="border-t border-border-neutral-base bg-background-neutral-base px-44 py-12">
          {expandedContent}
        </div>
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
          attemptChipClasses[attempt.status.badge ?? 'neutral'],
        )}
      >
        #{attempt.attempt}
      </span>
    </div>
  );
}

function entryAccessibleLabel(entry: WorkflowStepListEntryModel): string {
  const parts = [
    `${entry.index}. ${entry.label}`,
    entry.status.label,
    `attempt ${entry.attempt.attempt}`,
  ];
  if (entry.error?.category) parts.push(humanizeStatus(entry.error.category));
  return parts.join(', ');
}

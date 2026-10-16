import {PROVIDER_CATALOG} from '@shipfox/client-integrations';
import {RequiredActionLink} from '@shipfox/client-shell/runtime';
import type {RequiredAction} from '@shipfox/policy-notice';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@shipfox/react-ui/accordion';
import {Badge, type BadgeVariant} from '@shipfox/react-ui/badge';
import {Dot} from '@shipfox/react-ui/dot';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {InspectorTrigger} from '@shipfox/react-ui/inspector';
import {TimeTickerProvider, useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn, humanDuration} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {
  isWorkflowStatus,
  type Job,
  type JobDisplayStatus,
  type JobExecution,
  type Step,
  type StepSourceLocation,
} from '#core/workflow-run.js';
import {formatJobExecutionTimeLabel} from '../job-graph/job-duration-format.js';
import {
  buildStepListModel,
  CANCELLING_TEXT,
  defaultStepListJobExecution,
  entriesByParentEntryId,
  humanizeStatus,
  IGNORED_FAILURE_TEXT,
  isCompositeEntry,
  openStepListEntryIds,
  type StepAttemptModel,
  type StepListEntryModel,
  type StepListModel,
  type StepModel,
  selectionAfterOpenChange,
} from './step-list-model.js';

// A child row's chevron lines up under its parent's status icon: chevron width plus row gap.
const NESTED_ROW_INDENT_PX = 22;

export interface StepExpandedContext {
  step: Step;
  stepId: string;
  stepLabel: string;
  sourceLocation: StepSourceLocation | null;
  attempt: number;
  attemptOrdinal: number;
  attemptId: string;
  attemptStartedAt: string;
  attemptError: Record<string, unknown> | null;
  attemptStatus: string;
  carriedOver: boolean;
}

export interface StepListEmptyState {
  title: string;
  description: string;
  status?: JobDisplayStatus | undefined;
  action?: RequiredAction | undefined;
}

export interface StepListProps {
  job: Job;
  jobExecution?: JobExecution | undefined;
  selectedAttemptId?: string | null | undefined;
  defaultSelectedAttemptId?: string | undefined;
  onSelectedAttemptChange?: ((attemptId: string | undefined) => void) | undefined;
  onExpandedAttemptIdsChange?: ((attemptIds: readonly string[]) => void) | undefined;
  inspectorOpenAttemptId?: string | null | undefined;
  onInspectorOpenChange?: ((attemptId: string | null) => void) | undefined;
  autoSelectActiveAttempt?: boolean | undefined;
  emptyState?: StepListEmptyState | undefined;
  renderStepFooter?: ((step: StepModel) => ReactNode) | undefined;
  renderExpandedStep?: ((context: StepExpandedContext) => ReactNode) | undefined;
  renderInspector?: ((entry: StepListEntryModel) => ReactNode) | undefined;
  showHeader?: boolean | undefined;
  className?: string | undefined;
}

export function StepList({
  job,
  jobExecution,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  onExpandedAttemptIdsChange,
  inspectorOpenAttemptId = null,
  onInspectorOpenChange,
  autoSelectActiveAttempt = false,
  emptyState,
  renderStepFooter,
  renderExpandedStep,
  renderInspector,
  showHeader = true,
  className,
}: StepListProps) {
  const model = useMemo(
    () => buildStepListModel({job, jobExecution: jobExecution ?? defaultStepListJobExecution(job)}),
    [job, jobExecution],
  );

  return (
    <StepListContent
      key={model.jobExecutionId}
      model={model}
      selectedAttemptId={selectedAttemptId}
      defaultSelectedAttemptId={defaultSelectedAttemptId}
      onSelectedAttemptChange={onSelectedAttemptChange}
      onExpandedAttemptIdsChange={onExpandedAttemptIdsChange}
      inspectorOpenAttemptId={inspectorOpenAttemptId}
      onInspectorOpenChange={onInspectorOpenChange}
      autoSelectActiveAttempt={autoSelectActiveAttempt}
      emptyState={emptyState}
      renderStepFooter={renderStepFooter}
      renderExpandedStep={renderExpandedStep}
      renderInspector={renderInspector}
      showHeader={showHeader}
      className={className}
    />
  );
}

function StepListContent({
  model,
  selectedAttemptId,
  defaultSelectedAttemptId,
  onSelectedAttemptChange,
  onExpandedAttemptIdsChange,
  inspectorOpenAttemptId = null,
  onInspectorOpenChange,
  autoSelectActiveAttempt,
  emptyState,
  renderStepFooter,
  renderExpandedStep,
  renderInspector,
  showHeader,
  className,
}: Omit<StepListProps, 'job' | 'jobExecution'> & {model: StepListModel}) {
  const titleId = useId();
  const [localSelectedAttemptIds, setLocalSelectedAttemptIds] = useState<string[]>(() => {
    if (selectedAttemptId) return [selectedAttemptId];
    if (defaultSelectedAttemptId) return [defaultSelectedAttemptId];
    return [];
  });
  const [userSelectedAttempt, setUserSelectedAttempt] = useState(false);
  const lastNotifiedSelectedAttemptId = useRef<string | null>(null);
  const autoSelectedAttemptIdRef = useRef<string | undefined>(undefined);
  const previousSelectedAttemptIdRef = useRef<string | null | undefined>(selectedAttemptId);
  const lastReportedExpandedAttemptIdsKeyRef = useRef<string | null>(null);
  // Set when this list closes its last open row, so the parent clearing its controlled selection
  // in response does not reopen the default row.
  const clearedSelectionRef = useRef(false);
  const shouldUseControlledCollapsedState =
    selectedAttemptId === null && lastNotifiedSelectedAttemptId.current === null;
  const autoSelectedAttemptId =
    selectedAttemptId === undefined && autoSelectActiveAttempt && !userSelectedAttempt
      ? (autoSelectedAttemptIdRef.current ?? model.activeEntryId)
      : undefined;
  const autoSelectedAttemptIds = useMemo(
    () => (autoSelectedAttemptId ? [autoSelectedAttemptId] : []),
    [autoSelectedAttemptId],
  );
  const selectedAttemptIds = useMemo(() => {
    if (shouldUseControlledCollapsedState) return [];
    if (localSelectedAttemptIds.length > 0) return localSelectedAttemptIds;
    return autoSelectedAttemptIds;
  }, [autoSelectedAttemptIds, localSelectedAttemptIds, shouldUseControlledCollapsedState]);
  const hasExpandedContent = renderExpandedStep !== undefined;
  const tree = useMemo(() => stepListTree(model.entries), [model.entries]);
  const openAttemptIds = useMemo(
    () => openStepListEntryIds(model.entries, selectedAttemptIds),
    [model.entries, selectedAttemptIds],
  );
  const openAttemptIdSet = useMemo(() => new Set(openAttemptIds), [openAttemptIds]);
  // A composite runs on the server and writes no logs, so only its inner steps report as expanded.
  const expandedLogAttemptIds = useMemo(
    () => selectedAttemptIds.filter((attemptId) => !tree.compositeEntryIds.has(attemptId)),
    [tree, selectedAttemptIds],
  );

  useEffect(() => {
    const key = expandedLogAttemptIds.join('|');
    if (lastReportedExpandedAttemptIdsKeyRef.current === key) return;
    lastReportedExpandedAttemptIdsKeyRef.current = key;
    onExpandedAttemptIdsChange?.(expandedLogAttemptIds);
  }, [onExpandedAttemptIdsChange, expandedLogAttemptIds]);

  useEffect(() => {
    if (selectedAttemptId !== undefined) {
      previousSelectedAttemptIdRef.current = selectedAttemptId;
      return;
    }

    // A changing landing candidate is normal while a live job polls. Only reset the local
    // accordion when the parent has just cleared a previously controlled URL selection.
    const wasControlled = previousSelectedAttemptIdRef.current !== undefined;
    previousSelectedAttemptIdRef.current = undefined;
    const clearedByList = clearedSelectionRef.current;
    clearedSelectionRef.current = false;
    if (!wasControlled || clearedByList) return;

    setLocalSelectedAttemptIds(defaultSelectedAttemptId ? [defaultSelectedAttemptId] : []);
    setUserSelectedAttempt(false);
    autoSelectedAttemptIdRef.current = undefined;
  }, [defaultSelectedAttemptId, selectedAttemptId]);

  useEffect(() => {
    if (
      selectedAttemptId !== undefined ||
      !autoSelectActiveAttempt ||
      userSelectedAttempt ||
      localSelectedAttemptIds.length > 0 ||
      autoSelectedAttemptIdRef.current !== undefined
    ) {
      return;
    }
    if (model.activeEntryId) autoSelectedAttemptIdRef.current = model.activeEntryId;
  }, [
    autoSelectActiveAttempt,
    localSelectedAttemptIds.length,
    model.activeEntryId,
    selectedAttemptId,
    userSelectedAttempt,
  ]);

  useEffect(() => {
    if (selectedAttemptId === undefined) return;

    const nextSelectedAttemptId = selectedAttemptId ?? null;
    if (lastNotifiedSelectedAttemptId.current === nextSelectedAttemptId) {
      lastNotifiedSelectedAttemptId.current = null;
      return;
    }

    clearedSelectionRef.current = false;
    setLocalSelectedAttemptIds(selectedAttemptId ? [selectedAttemptId] : []);
    setUserSelectedAttempt(true);
  }, [selectedAttemptId]);

  useEffect(() => {
    if (
      inspectorOpenAttemptId !== null &&
      !model.entries.some((entry) => entry.id === inspectorOpenAttemptId && !entry.carriedOver)
    ) {
      onInspectorOpenChange?.(null);
    }
  }, [inspectorOpenAttemptId, model.entries, onInspectorOpenChange]);

  function selectAttempt(nextAttemptIds: string[]) {
    const nextAttemptId = nextSelectedAttemptId(selectedAttemptIds, nextAttemptIds);
    setUserSelectedAttempt(true);
    setLocalSelectedAttemptIds(nextAttemptIds);
    lastNotifiedSelectedAttemptId.current = nextAttemptId ?? null;
    clearedSelectionRef.current = nextAttemptId === undefined;
    onSelectedAttemptChange?.(nextAttemptId);
  }

  function changeOpenAttempts(nextOpenIds: readonly string[]) {
    selectAttempt(
      selectionAfterOpenChange({
        entries: model.entries,
        selectedIds: selectedAttemptIds,
        nextOpenIds,
      }),
    );
  }

  const inspectorEntry = model.entries.find(
    (entry) => entry.id === inspectorOpenAttemptId && !entry.carriedOver,
  );

  function inspectHandler(entry: StepListEntryModel): (() => void) | undefined {
    if (!onInspectorOpenChange || entry.carriedOver) return undefined;
    return () => onInspectorOpenChange(entry.id);
  }

  function renderEntries(entries: readonly StepListEntryModel[]): ReactNode {
    return entries.map(renderEntry);
  }

  function renderEntry(entry: StepListEntryModel): ReactNode {
    const open = openAttemptIdSet.has(entry.id);
    const group = tree.compositeEntryIds.has(entry.id);
    return (
      <StepRow
        key={entry.id}
        entry={entry}
        open={open}
        selected={selectedAttemptIds.includes(entry.id)}
        group={group}
        hasExpandedContent={hasExpandedContent}
        isLast={entry.id === tree.lastEntryId}
        onSelect={() =>
          open
            ? changeOpenAttempts(openAttemptIds.filter((attemptId) => attemptId !== entry.id))
            : selectAttempt([entry.id])
        }
        onInspect={inspectHandler(entry)}
        inspecting={inspectorOpenAttemptId === entry.id}
        expandedContent={open && !group ? renderExpandedStep?.(expandedContext(entry)) : null}
        nestedEntries={
          open && group ? (
            <StepGroupEntries depth={entry.depth + 1}>
              {renderEntries(tree.childrenByParentEntryId.get(entry.id) ?? [])}
            </StepGroupEntries>
          ) : null
        }
        stepFooter={
          tree.lastEntryIdByStepId.get(entry.step.id) === entry.id
            ? renderStepFooter?.(entry.step)
            : null
        }
      />
    );
  }

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <section
        aria-labelledby={showHeader ? titleId : undefined}
        className={cn(
          'flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-neutral-base',
          className,
        )}
      >
        {showHeader ? (
          <div className="flex min-h-40 items-center border-b border-border-neutral-base px-row py-row">
            <Text as="h2" id={titleId} size="sm" bold className="text-foreground-neutral-base">
              {model.jobName}
            </Text>
          </div>
        ) : null}

        {model.entries.length === 0 ? (
          <StepListEmptyStateView emptyState={emptyState} />
        ) : (
          <Accordion
            type="multiple"
            value={openAttemptIds}
            onValueChange={changeOpenAttempts}
            asChild
          >
            <ol>{renderEntries(tree.childrenByParentEntryId.get(undefined) ?? [])}</ol>
          </Accordion>
        )}
      </section>
      {inspectorEntry ? renderInspector?.(inspectorEntry) : null}
    </TimeTickerProvider>
  );
}

function stepListTree(entries: readonly StepListEntryModel[]) {
  return {
    childrenByParentEntryId: entriesByParentEntryId(entries),
    compositeEntryIds: new Set(entries.filter(isCompositeEntry).map((entry) => entry.id)),
    lastEntryIdByStepId: new Map(entries.map((entry) => [entry.step.id, entry.id])),
    lastEntryId: entries.at(-1)?.id,
  };
}

function expandedContext(entry: StepListEntryModel): StepExpandedContext {
  return {
    step: entry.step,
    stepId: entry.step.id,
    stepLabel: entry.step.label,
    sourceLocation: entry.step.sourceLocation,
    attempt: entry.attempt,
    attemptOrdinal: entry.attemptOrdinal,
    attemptId: entry.id,
    attemptStartedAt: entry.startedAt,
    attemptError: entry.error,
    attemptStatus: entry.statusVisual.kind,
    carriedOver: entry.carriedOver,
  };
}

function StepListEmptyStateView({
  emptyState = {
    title: 'No steps recorded',
    description: 'This job has not recorded any steps.',
  },
}: {
  emptyState?: StepListEmptyState | undefined;
}) {
  if (!emptyState.status) {
    return (
      <EmptyState
        icon="componentLine"
        title={emptyState.title}
        description={emptyState.description}
        variant="panel"
      />
    );
  }

  return (
    <div className="flex min-h-120 flex-col items-center justify-center gap-inline p-panel">
      <StepListEmptyStateIcon status={emptyState.status} />
      <div className="text-center">
        <Text size="sm" className="text-foreground-neutral-subtle">
          {emptyState.title}
        </Text>
        <Text size="xs" className="text-foreground-neutral-muted">
          {emptyState.description}
        </Text>
      </div>
      {emptyState.action ? (
        <RequiredActionLink action={emptyState.action} appearance="link" />
      ) : null}
    </div>
  );
}

function StepListEmptyStateIcon({status}: {status: JobDisplayStatus}) {
  if (status !== 'running') {
    return (
      <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-tight">
        <WorkflowStatusIcon status={status} size={20} tooltip={false} />
      </div>
    );
  }

  return (
    <div className="flex size-32 items-center justify-center rounded-6 border border-border-neutral-strong bg-background-neutral-base p-tight text-foreground-neutral-muted">
      <Icon name="timerLine" size={18} aria-hidden="true" />
    </div>
  );
}

function StepGroupEntries({depth, children}: {depth: number; children: ReactNode}) {
  const hasEntries = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hasEntries) {
    return (
      <Text
        size="xs"
        className="px-row py-row text-foreground-neutral-muted"
        style={nestedRowIndentStyle(depth)}
      >
        No inner steps have run in this attempt.
      </Text>
    );
  }
  return <ol>{children}</ol>;
}

function nestedRowIndentStyle(depth: number) {
  if (depth === 0) return undefined;
  return {paddingInlineStart: `calc(var(--pad-row-x) + ${depth * NESTED_ROW_INDENT_PX}px)`};
}

function StepRow({
  entry,
  open,
  selected,
  group,
  hasExpandedContent,
  isLast,
  onSelect,
  onInspect,
  inspecting,
  expandedContent,
  nestedEntries,
  stepFooter,
}: {
  entry: StepListEntryModel;
  open: boolean;
  selected: boolean;
  group: boolean;
  hasExpandedContent: boolean;
  isLast: boolean;
  onSelect: () => void;
  onInspect?: (() => void) | undefined;
  inspecting: boolean;
  expandedContent: ReactNode;
  nestedEntries: ReactNode;
  stepFooter: ReactNode;
}) {
  const shouldShowLabelTooltip = entry.step.label.length > 32;
  const rowContent = <StepRowSummary entry={entry} open={open} />;
  const rowClasses = cn(
    'group flex min-h-44 min-w-0 flex-1 items-center gap-x-inline bg-transparent px-row py-row text-left transition-colors hover:bg-transparent active:bg-transparent focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
    entry.carriedOver && 'opacity-[0.55]',
  );
  const indentStyle = nestedRowIndentStyle(entry.depth);
  const button = hasExpandedContent ? (
    <AccordionTrigger
      showIcon={false}
      aria-label={entryAccessibleLabel(entry)}
      className={rowClasses}
      style={indentStyle}
    >
      {rowContent}
    </AccordionTrigger>
  ) : (
    <button
      type="button"
      aria-expanded={group ? open : false}
      aria-label={entryAccessibleLabel(entry)}
      onClick={onSelect}
      className={rowClasses}
      style={indentStyle}
    >
      {rowContent}
    </button>
  );
  const triggerNode = shouldShowLabelTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        <span className="block max-w-320 break-words">{entry.step.label}</span>
      </TooltipContent>
    </Tooltip>
  ) : (
    button
  );
  const row = (
    <>
      <div
        className={cn(
          'group flex min-w-0 items-center gap-inline bg-background-neutral-base pr-[8px] transition-colors hover:bg-background-neutral-hover active:bg-background-neutral-pressed',
          selected && 'bg-background-neutral-hover',
          selected && hasExpandedContent && !group && 'sticky top-0 z-10',
          !hasExpandedContent && ['border-b border-border-neutral-base', isLast && 'border-b-0'],
        )}
      >
        <div className="min-w-0 flex-1">{triggerNode}</div>
        {onInspect ? (
          <InspectorTrigger
            open={inspecting}
            size="xs"
            aria-label={`Inspect step ${entry.step.label}, attempt ${entry.attemptOrdinal}`}
            onClick={onInspect}
          >
            Inspect step
          </InspectorTrigger>
        ) : null}
      </div>
      <StepRowExpansion
        open={open}
        hasExpandedContent={hasExpandedContent}
        content={expandedContent ?? nestedEntries}
      />
      {stepFooter}
    </>
  );

  if (hasExpandedContent) {
    return (
      <AccordionItem value={entry.id} asChild>
        <li>{row}</li>
      </AccordionItem>
    );
  }

  return <li>{row}</li>;
}

function StepRowSummary({entry, open}: {entry: StepListEntryModel; open: boolean}) {
  return (
    <>
      <Icon
        name="chevronRight"
        aria-hidden="true"
        className={cn(
          'size-14 shrink-0 text-foreground-neutral-muted transition-transform',
          open && 'rotate-90',
        )}
      />
      <StepStatusIcon entry={entry} />
      <ToolProviderIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-inline">
          <Text size="sm" bold className="truncate text-foreground-neutral-base">
            {entry.step.label}
          </Text>
          {entry.step.attempts.length > 1 ? <StepAttemptChip attempt={entry} /> : null}
          <ConcurrencyMarker entry={entry} />
          {entry.carriedOver ? <CarriedOverBadge /> : null}
        </div>
        {entry.failureIgnored ? (
          <Text as="span" size="xs" className="block truncate text-foreground-neutral-muted">
            {IGNORED_FAILURE_TEXT}
          </Text>
        ) : null}
        {entry.stopping ? (
          <Text as="span" size="xs" className="block truncate text-foreground-neutral-muted">
            {CANCELLING_TEXT}
          </Text>
        ) : null}
      </div>
      <StepAttemptDurationLabel attempt={entry} />
    </>
  );
}

/** Logs or inner steps under an open row. Without accordion content, inner steps render inline. */
function StepRowExpansion({
  open,
  hasExpandedContent,
  content,
}: {
  open: boolean;
  hasExpandedContent: boolean;
  content: ReactNode;
}) {
  if (!open || !content) return null;
  if (!hasExpandedContent) return content;
  return (
    <AccordionContent className="border-t border-border-neutral-base bg-transparent px-0 py-0">
      <div className="min-w-0">{content}</div>
    </AccordionContent>
  );
}

// How a step runs beside others. Metadata, not state, so it is muted label text, not a pill.
function concurrencyMarker(entry: StepListEntryModel) {
  if (entry.step.type === 'wait') return undefined;
  if (entry.step.parallelGroup !== undefined) {
    return {
      label: 'parallel',
      description: 'Runs at the same time as the other steps in its block.',
    };
  }
  if (entry.step.background) {
    return {
      label: 'background',
      description: 'Runs while the job moves on. A later wait joins it.',
    };
  }
  return undefined;
}

function ConcurrencyMarker({entry}: {entry: StepListEntryModel}) {
  const marker = concurrencyMarker(entry);
  if (!marker) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Text as="span" size="xs" className="shrink-0 text-foreground-neutral-muted">
          {marker.label}
        </Text>
      </TooltipTrigger>
      <TooltipContent>{marker.description}</TooltipContent>
    </Tooltip>
  );
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

function StepStatusIcon({entry}: {entry: StepListEntryModel}) {
  if (entry.stopping) {
    return <WorkflowStatusIcon status="cancelled" ariaLabel="Cancelling" size={14} />;
  }
  if (entry.failureIgnored) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label="Failed, job result unchanged"
            className="inline-flex size-14 shrink-0 items-center justify-center text-tag-warning-icon"
          >
            <Icon name="errorWarningFill" size={15} />
          </span>
        </TooltipTrigger>
        <TooltipContent>Failed, job result unchanged</TooltipContent>
      </Tooltip>
    );
  }
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

function ToolProviderIcon({entry}: {entry: StepListEntryModel}) {
  if (isCompositeEntry(entry)) {
    return (
      <Icon
        name="stackLine"
        size={14}
        aria-hidden="true"
        className="shrink-0 text-foreground-neutral-muted"
      />
    );
  }
  if (entry.step.type === 'action' || entry.step.type === 'post') {
    return (
      <Icon
        name="codeBoxLine"
        size={14}
        aria-hidden="true"
        className="shrink-0 text-foreground-neutral-muted"
      />
    );
  }
  if (entry.step.type === 'wait' || entry.step.type === 'cancel') {
    return (
      <Icon
        name={entry.step.type === 'wait' ? 'hourglassLine' : 'stopCircleLine'}
        size={14}
        aria-hidden="true"
        className="shrink-0 text-foreground-neutral-muted"
      />
    );
  }
  if (entry.step.type !== 'tool') return null;
  const provider = entry.step.toolConfig?.provider;
  const catalogEntry = provider ? PROVIDER_CATALOG[provider] : undefined;
  return (
    <Icon
      name={catalogEntry?.iconName ?? 'componentLine'}
      size={14}
      aria-hidden="true"
      className="shrink-0 text-foreground-neutral-muted"
    />
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

function StepAttemptChip({attempt}: {attempt: StepAttemptModel}) {
  return (
    <div className="flex shrink-0 items-center gap-tight" aria-hidden="true">
      <span
        className={cn(
          'inline-flex h-18 min-w-24 items-center justify-center rounded-4 border px-tight font-code text-xs leading-16 text-foreground-neutral-base',
          attemptChipClasses[attempt.statusVisual.badge ?? 'neutral'],
        )}
      >
        #{attempt.attemptOrdinal}
      </span>
    </div>
  );
}

function entryAccessibleLabel(entry: StepListEntryModel): string {
  const parts = [entry.step.label, entry.statusVisual.label, `attempt ${entry.attemptOrdinal}`];
  if (isCompositeEntry(entry)) parts.push('composite action');
  if (entry.step.type === 'action') parts.push('action');
  if (entry.step.type === 'post') parts.push('action post');
  if (entry.step.type === 'wait') parts.push('wait step');
  if (entry.step.type === 'cancel') parts.push('cancel step');
  const marker = concurrencyMarker(entry);
  if (marker) parts.push(`${marker.label} step`);
  if (entry.failureIgnored) parts.push('job result unchanged');
  if (entry.step.toolConfig?.provider) {
    const provider = entry.step.toolConfig.provider;
    parts.push(
      `${PROVIDER_CATALOG[provider]?.displayName ?? humanizeStatus(provider)} integration`,
    );
  }
  if (entry.step.error?.category) parts.push(humanizeStatus(entry.step.error.category));
  return parts.join(', ');
}

function StepAttemptDurationLabel({attempt}: {attempt: StepAttemptModel}) {
  const duration = attempt.displayDuration;
  if (duration === null) return null;

  if (duration.state === 'live') {
    return <LiveDurationText fromIso={duration.fromIso} />;
  }

  return <DurationText>{formatJobExecutionTimeLabel(duration)}</DurationText>;
}

function LiveDurationText({fromIso}: {fromIso: string}) {
  useTimeTick();
  return <DurationText>{humanDuration(fromIso)}</DurationText>;
}

function DurationText({children}: {children: string}) {
  return (
    <Code as="span" variant="label" className="shrink-0 tabular-nums text-foreground-neutral-muted">
      {children}
    </Code>
  );
}

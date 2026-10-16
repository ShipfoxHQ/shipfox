import {
  getWorkflowStatusVisual,
  type WorkflowStatusVisual,
} from '#components/workflow-status/status-visuals.js';
import {compositeAncestors} from '#core/composite-step.js';
import {
  defaultJobExecution,
  isWorkflowStatus as isKnownWorkflowStatus,
  type Job,
  JobExecution,
  type Step,
  type StepAttempt,
  type StepAttemptDisplayDuration,
} from '#core/workflow-run.js';

export const IGNORED_FAILURE_TEXT = 'This step failed. The job result is unchanged.';
export const CANCELLING_TEXT = 'Cancelling. Waiting for the process to stop.';

const KEY_PATH_SEPARATOR = ' › ';

export interface StepStatusVisual extends Omit<WorkflowStatusVisual, 'kind'> {
  kind: string;
  ripple: boolean;
}

export interface StepAttemptModel extends StepAttempt {
  attemptOrdinal: number;
  displayDuration: StepAttemptDisplayDuration | null;
  statusVisual: StepStatusVisual;
  carriedOver: boolean;
  /** A failed attempt that leaves the job result unchanged. */
  failureIgnored: boolean;
  /** The step is cancelled, but its process has not stopped yet. */
  stopping: boolean;
}

export interface StepModel extends Omit<Step, 'attempts'> {
  index: number;
  label: string;
  /** Label of the step whose action declared this post, when that step is loaded. */
  mainStepLabel?: string | undefined;
  attempts: StepAttemptModel[];
}

export interface StepListEntryModel extends StepAttemptModel {
  step: StepModel;
  /** The composite attempt entry this entry ran under. Absent for a job step. */
  parentEntryId?: string | undefined;
  /** Nesting level under composite entries; 0 for a job step. */
  depth: number;
}

export interface StepListModel {
  jobId: string;
  jobName: string;
  jobExecutionId: string;
  stepCount: number;
  activeEntryId: string | undefined;
  entries: StepListEntryModel[];
}

export function buildStepListModel({
  job,
  jobExecution,
}: {
  job: Job;
  jobExecution?: JobExecution | undefined;
}): StepListModel {
  const selectedJobExecution = jobExecution ?? defaultStepListJobExecution(job);
  const steps = withMainStepLabels(
    withKeyPathLabels([...selectedJobExecution.steps].sort(compareSteps).map(toStepModel)),
  );
  const entries = groupCompositeEntries(
    steps.flatMap((step) => toStepEntries(step, job.carriedOver)).sort(compareEntries),
  );

  return {
    jobId: job.id,
    jobName: job.name ?? job.key,
    jobExecutionId: selectedJobExecution.id,
    stepCount: steps.length,
    activeEntryId: followedRunningEntry(entries)?.id,
    entries,
  };
}

/**
 * A running entry the page can follow. A wait row has no output of its own, and a stopping step
 * is already cancelled, so neither counts.
 */
export function isFollowableRunningEntry(entry: StepListEntryModel): boolean {
  return entry.statusVisual.kind === 'running' && !entry.stopping && entry.step.type !== 'wait';
}

// The latest followable entry the job waits on, else the earliest background one.
function followedRunningEntry(
  entries: readonly StepListEntryModel[],
): StepListEntryModel | undefined {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const running = entries.filter(isFollowableRunningEntry);
  const runsInBackground = (entry: StepListEntryModel): boolean => {
    for (let current: StepListEntryModel | undefined = entry; current; ) {
      if (current.step.background) return true;
      current =
        current.parentEntryId === undefined ? undefined : entryById.get(current.parentEntryId);
    }
    return false;
  };
  return running.filter((entry) => !runsInBackground(entry)).at(-1) ?? running[0];
}

export function isCompositeEntry(entry: Pick<StepListEntryModel, 'step'>): boolean {
  return entry.step.type === 'composite';
}

/** The selected entries plus every composite entry that holds one, outermost first. */
export function openStepListEntryIds(
  entries: readonly StepListEntryModel[],
  selectedIds: readonly string[],
): string[] {
  return [...openEntryIds(parentEntryIdById(entries), selectedIds)];
}

/**
 * Applies an open-state change from the list. Opening an entry selects it. Closing a composite
 * entry also deselects every entry inside it, so a selected inner step cannot keep it open.
 * Closing an inner entry leaves its composites open, so the innermost one is selected in its
 * place.
 */
export function selectionAfterOpenChange({
  entries,
  selectedIds,
  nextOpenIds,
}: {
  entries: readonly StepListEntryModel[];
  selectedIds: readonly string[];
  nextOpenIds: readonly string[];
}): string[] {
  const parentById = parentEntryIdById(entries);
  const openIds = openEntryIds(parentById, selectedIds);
  const nextOpen = new Set(nextOpenIds);
  const closedIds = new Set([...openIds].filter((id) => !nextOpen.has(id)));
  const isInsideClosed = (id: string) =>
    closedIds.has(id) ||
    entryAncestorIds(parentById, id).some((ancestor) => closedIds.has(ancestor));

  const selection = [
    ...selectedIds.filter((id) => !isInsideClosed(id)),
    ...nextOpenIds.filter((id) => !openIds.has(id)),
  ];
  const stillOpen = openEntryIds(parentById, selection);
  for (const id of [...nextOpenIds].reverse()) {
    if (stillOpen.has(id) || isInsideClosed(id)) continue;
    selection.push(id);
    for (const openId of [id, ...entryAncestorIds(parentById, id)]) stillOpen.add(openId);
  }
  return selection;
}

function parentEntryIdById(entries: readonly StepListEntryModel[]) {
  return new Map(entries.map((entry) => [entry.id, entry.parentEntryId]));
}

function openEntryIds(
  parentById: ReadonlyMap<string, string | undefined>,
  selectedIds: readonly string[],
): Set<string> {
  const open = new Set<string>();
  for (const id of selectedIds) {
    for (const openId of [...entryAncestorIds(parentById, id).reverse(), id]) open.add(openId);
  }
  return open;
}

/** The composite entries that hold `id`, innermost first. */
function entryAncestorIds(
  parentById: ReadonlyMap<string, string | undefined>,
  id: string,
): string[] {
  const ancestors: string[] = [];
  let parentId = parentById.get(id);
  while (parentId !== undefined && parentId !== id && !ancestors.includes(parentId)) {
    ancestors.push(parentId);
    parentId = parentById.get(parentId);
  }
  return ancestors;
}

export function defaultStepListJobExecution(job: Job): JobExecution {
  return defaultJobExecution(job) ?? emptyJobExecutionForJob(job);
}

export function emptyJobExecutionForJob(job: Job): JobExecution {
  return new JobExecution({
    id: `missing:${job.id}`,
    jobId: job.id,
    sequence: 1,
    name: job.name ?? job.key,
    status: job.status === 'skipped' ? 'cancelled' : job.status,
    statusReason: job.statusReason,
    statusReasonMessage: null,
    runner: job.runner,
    outputs: job.outputs,
    triggerEvents: [],
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    timedOutAt: null,
    durationCapped: false,
    durationNotice: null,
    evaluationTrace: job.evaluationTrace,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    steps: [],
  });
}

export function getStepStatusVisual(status: string): StepStatusVisual {
  const normalized = normalizeStatus(status);

  if (isKnownWorkflowStatus(normalized)) {
    const visual = getWorkflowStatusVisual(normalized);
    return {...visual, ripple: normalized === 'running'};
  }

  return {
    kind: status,
    label: humanizeStatus(status),
    dot: 'neutral',
    badge: 'neutral',
    ripple: false,
  };
}

export function humanizeStatus(status: string): string {
  const words = status.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (!words) return 'Unknown';
  const firstLetter = words.at(0);
  return firstLetter === undefined ? 'Unknown' : firstLetter.toUpperCase() + words.slice(1);
}

function toStepModel(step: Step, index: number): StepModel {
  const sortedAttempts = [...step.attempts].sort(compareAttempts);
  const gateAttemptOffset =
    step.gateMaxAttempts === undefined
      ? undefined
      : Math.max(0, (step.attemptTotal ?? sortedAttempts.length) - sortedAttempts.length);
  const attempts = sortedAttempts.map((attempt, attemptIndex) => {
    const failureIgnored = isIgnoredFailure(step, attempt);
    const stopping = isStopping(step, attempt);
    return {
      ...attempt,
      attemptOrdinal:
        gateAttemptOffset === undefined ? attempt.attempt : gateAttemptOffset + attemptIndex + 1,
      displayDuration: attempt.displayDuration,
      statusVisual: entryStatusVisual(attempt.status, {failureIgnored, stopping}),
      carriedOver: false,
      failureIgnored,
      stopping,
    };
  });

  return {
    ...step,
    index: index + 1,
    label: stepLabel(step, index),
    attempts,
  };
}

// The server marks each failed attempt that `continue_on_error` covered, and the step itself when
// its current failure leaves the job result unchanged, as for a post with `post_failure: warn`.
function isIgnoredFailure(
  step: Pick<Step, 'affectsJob' | 'currentAttempt'>,
  attempt: {status: string; attempt: number; failureIgnored?: boolean | undefined},
): boolean {
  if (normalizeStatus(attempt.status) !== 'failed') return false;
  if (attempt.failureIgnored === true) return true;
  return attempt.attempt === step.currentAttempt && step.affectsJob === false;
}

// A cancel turns the step cancelled at once, and its attempt stays running until the runner
// confirms the process stopped.
function isStopping(
  step: Pick<Step, 'status' | 'currentAttempt'>,
  attempt: {status: string; attempt: number},
): boolean {
  return (
    normalizeStatus(step.status) === 'cancelled' &&
    normalizeStatus(attempt.status) === 'running' &&
    attempt.attempt === step.currentAttempt
  );
}

// A stopping attempt keeps its running kind, so its log stays live until the process exits.
function entryStatusVisual(
  status: string,
  {failureIgnored, stopping}: {failureIgnored: boolean; stopping: boolean},
): StepStatusVisual {
  const visual = getStepStatusVisual(status);
  if (stopping) return {...visual, label: 'Cancelling', dot: 'neutral', badge: 'neutral'};
  return failureIgnored ? {...visual, dot: 'warning', badge: 'warning'} : visual;
}

function withMainStepLabels(steps: StepModel[]): StepModel[] {
  const labelById = new Map(steps.map((step) => [step.id, step.label]));
  return steps.map((step) =>
    step.mainStepId === undefined ? step : {...step, mainStepLabel: labelById.get(step.mainStepId)},
  );
}

/** Inner steps of a composite read as a key path, such as `setup › changed_files`. */
function withKeyPathLabels(steps: StepModel[]): StepModel[] {
  return steps.map((step) => {
    if (step.parentStepId === undefined) return step;
    const path = [...compositeAncestors(steps, step.id), step];
    return {...step, label: path.map(keyPathSegment).join(KEY_PATH_SEPARATOR)};
  });
}

function keyPathSegment(step: StepModel): string {
  return step.key?.trim() || step.label;
}

/**
 * Orders entries as a tree: each composite attempt entry is followed by the inner entries that
 * ran under it. A composite attempt opens before any inner attempt of its pass, so an inner
 * entry belongs to the latest parent attempt that started at or before it.
 */
function groupCompositeEntries(entries: StepListEntryModel[]): StepListEntryModel[] {
  const entriesByStepId = groupBy(entries, (entry) => entry.step.id);
  const childrenByParentEntryId = groupBy(entries, (entry) => {
    const parentStepId = entry.step.parentStepId;
    if (parentStepId === undefined) return undefined;
    return enclosingParentEntry(entriesByStepId.get(parentStepId) ?? [], entry)?.id;
  });

  const ordered: StepListEntryModel[] = [];
  const visit = (parentEntryId: string | undefined, depth: number) => {
    for (const child of childrenByParentEntryId.get(parentEntryId) ?? []) {
      ordered.push({...child, parentEntryId, depth});
      visit(child.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return ordered;
}

/** The entries directly under each composite entry, in list order. Job steps sit under `undefined`. */
export function entriesByParentEntryId(
  entries: readonly StepListEntryModel[],
): Map<string | undefined, StepListEntryModel[]> {
  return groupBy(entries, (entry) => entry.parentEntryId);
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function enclosingParentEntry(
  parentEntries: readonly StepListEntryModel[],
  entry: StepListEntryModel,
): StepListEntryModel | undefined {
  let match = parentEntries[0];
  for (const candidate of parentEntries) {
    if (candidate.executionOrder > entry.executionOrder) break;
    match = candidate;
  }
  return match;
}

export function stepLabel(step: Step, index: number): string {
  const name = step.name.trim();
  if (name) return name;

  const key = step.key?.trim();
  if (key) return key;

  return `Step ${index + 1}`;
}

function toStepEntries(step: StepModel, carriedOverJob: boolean): StepListEntryModel[] {
  if (step.attempts.length > 0) {
    return step.attempts.map((attempt) => ({
      ...attempt,
      step,
      depth: 0,
    }));
  }

  if (!carriedOverJob) return [];

  const failureIgnored = isIgnoredFailure(step, {
    status: step.status,
    attempt: step.currentAttempt,
  });

  return [
    {
      id: `carried-over:${step.id}`,
      stepId: step.id,
      jobExecutionId: step.jobExecutionId,
      attempt: step.currentAttempt,
      attemptOrdinal: step.currentAttempt,
      executionOrder: step.position,
      status: step.status,
      exitCode: null,
      output: null,
      outputs: null,
      response: null,
      error: null,
      gateResult: null,
      restartFeedback: null,
      invocations: [],
      startedAt: step.createdAt,
      finishedAt: null,
      displayDuration: null,
      statusVisual: entryStatusVisual(step.status, {failureIgnored, stopping: false}),
      carriedOver: true,
      failureIgnored,
      stopping: false,
      step,
      depth: 0,
    },
  ];
}

function compareSteps(left: Step, right: Step): number {
  return (
    left.position - right.position ||
    (left.name ?? '').localeCompare(right.name ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function compareAttempts(left: Step['attempts'][number], right: Step['attempts'][number]) {
  return left.attempt - right.attempt || left.id.localeCompare(right.id);
}

function compareEntries(left: StepListEntryModel, right: StepListEntryModel): number {
  return (
    left.executionOrder - right.executionOrder ||
    left.step.index - right.step.index ||
    left.attempt - right.attempt ||
    left.id.localeCompare(right.id)
  );
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/-/g, '_');
}

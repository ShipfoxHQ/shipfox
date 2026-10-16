import {
  isWorkflowDocumentParallelBlock,
  type WorkflowDocumentJob,
  type WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {stableId} from './stable-id.js';
import {issue} from './validation-issue.js';

type StepPath = readonly WorkflowModelValidationIssuePathSegment[];

/**
 * One step of a job once its `parallel` blocks are expanded into a flat list. A block becomes its
 * members, each a background step, followed by a wait that names exactly those members. The
 * normalizer works on this list, so a step has one index, and `path` maps it back to the document.
 */
export interface ExpandedStep {
  /** The authored step. A member carries `background: true`. A row the expansion adds holds `{}`. */
  readonly step: WorkflowDocumentStep;
  /** Where the step sits below the job, such as `['steps', 2, 'parallel', 1]`. */
  readonly path: StepPath;
  /** The index in the job's `steps`, which a `parallel` block shares across its rows. */
  readonly topIndex: number;
  /** Set on the members of a `parallel` block and on their wait. */
  readonly parallelGroup?: string;
  /** Set on the rows the expansion adds. */
  readonly synthetic?: 'parallel-wait' | 'end-of-job';
  /** The members of a block, as indexes into the expanded list. Set on `parallel-wait` rows. */
  readonly members?: readonly number[];
  readonly background: boolean;
  /** Whether the step is a member of a `parallel` block, which needs no `key`. */
  readonly viaParallel: boolean;
}

export interface ConcurrentStepControl {
  readonly kind: 'wait' | 'cancel';
  /** Step ids of background steps. */
  readonly targets: readonly string[];
  readonly origin: 'authored' | 'parallel' | 'end-of-job';
}

export interface JobConcurrencyPlan {
  /** The expanded steps, with the wait that closes the job when background steps are still running. */
  readonly entries: readonly ExpandedStep[];
  /** The wait and cancel rows, by index. */
  readonly controls: ReadonlyMap<number, ConcurrentStepControl>;
  /** For each background step that a wait joins, the index of that wait. */
  readonly joinedBy: ReadonlyMap<number, number>;
  /** For each background step that a cancel stops, the index of that cancel. */
  readonly cancelledBy: ReadonlyMap<number, number>;
  /** Whether any step runs in the background, so some `steps.<key>` are unreadable somewhere. */
  readonly hasBackground: boolean;
  /** Whether the step at `candidate` is readable by the step at `at`. */
  isReadable(candidate: number, at: number): boolean;
  /**
   * The index before which a step can still be running: its join, its cancel, or the end of the
   * job. A step outside the background ends at its own index.
   */
  windowEnd(index: number): number;
}

/** The id of a job step: its key, or its place in the expanded list when it has none. */
export function jobStepId(params: {jobId: string; index: number; key: string | undefined}): string {
  const local = params.key === undefined ? `step-${params.index + 1}` : stableId(params.key);
  return `${params.jobId}-${local}`;
}

/**
 * How the document numbers a step in a message: its index in `steps`, then its index in the
 * `parallel` block when it is a member. The expanded list numbers steps differently.
 */
export function documentStepNumber(entry: ExpandedStep | undefined, fallback: number): string {
  if (entry === undefined) return String(fallback);
  const member = entry.path[3];
  return member === undefined ? String(entry.topIndex) : `${entry.topIndex}.${member}`;
}

export function isControlStep(step: WorkflowDocumentStep): boolean {
  return step.wait !== undefined || step.wait_all !== undefined || step.cancel !== undefined;
}

/** Expands the `parallel` blocks of a job into background members followed by their wait. */
export function expandJobSteps(job: WorkflowDocumentJob): ExpandedStep[] {
  const entries: ExpandedStep[] = [];
  for (const [topIndex, entry] of job.steps.entries()) {
    if (!isWorkflowDocumentParallelBlock(entry)) {
      entries.push({
        step: entry,
        path: ['steps', topIndex],
        topIndex,
        background: entry.background === true,
        viaParallel: false,
      });
      continue;
    }
    const parallelGroup = `parallel-${topIndex + 1}`;
    const members: number[] = [];
    for (const [member, step] of entry.parallel.entries()) {
      members.push(entries.length);
      entries.push({
        step: {...step, background: true},
        path: ['steps', topIndex, 'parallel', member],
        topIndex,
        parallelGroup,
        background: true,
        viaParallel: true,
      });
    }
    entries.push({
      step: {},
      path: ['steps', topIndex],
      topIndex,
      parallelGroup,
      synthetic: 'parallel-wait',
      members,
      background: false,
      viaParallel: false,
    });
  }
  return entries;
}

interface PlanParams {
  jobId: string;
  sourceName: string;
  job: WorkflowDocumentJob;
  issues: WorkflowModelValidationIssue[];
}

/**
 * Walks the expanded steps of a job once, in order, and settles everything that depends on which
 * background steps are running. The walk keeps the background steps that are outstanding, which
 * means started and neither joined by a wait nor stopped by a cancel. It resolves each wait and
 * cancel to step ids, records the wait that joins every background step, and reports the rules
 * that need this order. When steps are still outstanding at the end, it closes the job with a wait
 * for them.
 *
 * Issue paths use indexes of the expanded list.
 */
export function planJobConcurrency(params: PlanParams): JobConcurrencyPlan {
  const entries = expandJobSteps(params.job);
  const walk: PlanWalk = {
    params,
    entries,
    controls: new Map(),
    joinedBy: new Map(),
    cancelledBy: new Map(),
    outstanding: new Set(),
    // Only background steps can be waited for or cancelled. Any step with a key can be a gate target.
    latestBackgroundByKey: new Map(),
    latestIndexByKey: new Map(),
  };

  for (const [index, entry] of entries.entries()) {
    if (entry.synthetic === 'parallel-wait') walkParallelWait(walk, index, entry);
    else if (isControlStep(entry.step)) walkControlStep(walk, index, entry.step);
    else walkWorkStep(walk, index, entry);
  }

  const closed = closeJob({
    entries,
    controls: walk.controls,
    joinedBy: walk.joinedBy,
    outstanding: walk.outstanding,
    jobId: params.jobId,
  });
  return buildPlan({...closed, cancelledBy: walk.cancelledBy});
}

interface PlanWalk {
  readonly params: PlanParams;
  readonly entries: readonly ExpandedStep[];
  readonly controls: Map<number, ConcurrentStepControl>;
  readonly joinedBy: Map<number, number>;
  readonly cancelledBy: Map<number, number>;
  readonly outstanding: Set<number>;
  readonly latestBackgroundByKey: Map<string, number>;
  readonly latestIndexByKey: Map<string, number>;
}

function stepIdAt(walk: PlanWalk, index: number): string {
  return jobStepId({
    jobId: walk.params.jobId,
    index,
    key: walk.entries[index]?.step.key,
  });
}

function issuePathAt(walk: PlanWalk, index: number) {
  return (...field: WorkflowModelValidationIssuePathSegment[]) =>
    ['jobs', walk.params.sourceName, 'steps', index, ...field] as const;
}

function walkParallelWait(walk: PlanWalk, index: number, entry: ExpandedStep): void {
  const members = entry.members ?? [];
  walk.controls.set(index, {
    kind: 'wait',
    targets: members.map((member) => stepIdAt(walk, member)),
    origin: 'parallel',
  });
  for (const member of members) {
    walk.outstanding.delete(member);
    walk.joinedBy.set(member, index);
  }
}

function walkControlStep(walk: PlanWalk, index: number, step: WorkflowDocumentStep): void {
  const kind = step.cancel === undefined ? 'wait' : 'cancel';
  const targets =
    step.wait_all !== undefined
      ? [...walk.outstanding].sort((left, right) => left - right)
      : resolveTargets({
          kind,
          names: toNames(step.wait ?? step.cancel),
          outstanding: walk.outstanding,
          latestByKey: walk.latestBackgroundByKey,
          entries: walk.entries,
          issues: walk.params.issues,
          at: issuePathAt(walk, index),
        });
  for (const target of targets) {
    walk.outstanding.delete(target);
    if (kind === 'wait') walk.joinedBy.set(target, index);
    else walk.cancelledBy.set(target, index);
  }
  walk.controls.set(index, {
    kind,
    targets: targets.map((target) => stepIdAt(walk, target)),
    origin: 'authored',
  });
}

function walkWorkStep(walk: PlanWalk, index: number, entry: ExpandedStep): void {
  const {step} = entry;
  const at = issuePathAt(walk, index);
  if (entry.background) {
    validateBackgroundStep({entry, at, issues: walk.params.issues});
    walk.outstanding.add(index);
    if (step.key !== undefined) walk.latestBackgroundByKey.set(step.key, index);
  } else {
    validateSequentialStep({
      step,
      entries: walk.entries,
      outstanding: walk.outstanding,
      latestIndexByKey: walk.latestIndexByKey,
      issues: walk.params.issues,
      at,
    });
  }
  if (step.key !== undefined) walk.latestIndexByKey.set(step.key, index);
}

function toNames(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function resolveTargets(params: {
  kind: 'wait' | 'cancel';
  names: readonly string[];
  outstanding: ReadonlySet<number>;
  latestByKey: ReadonlyMap<string, number>;
  entries: readonly ExpandedStep[];
  issues: WorkflowModelValidationIssue[];
  at: (...field: WorkflowModelValidationIssuePathSegment[]) => StepPath;
}): number[] {
  const targets: number[] = [];
  for (const [nameIndex, name] of params.names.entries()) {
    const target = params.latestByKey.get(name);
    const path = params.at(params.kind, ...(params.names.length > 1 ? [nameIndex] : []));
    if (target === undefined) {
      params.issues.push(
        issue({
          code: 'concurrent-step-target-unknown',
          message: `\`${params.kind}\` names \`${name}\`, but no background step has that key.`,
          path,
          details: {step: name},
        }),
      );
      continue;
    }
    if (!params.outstanding.has(target)) {
      params.issues.push(
        issue({
          code: 'concurrent-step-target-settled',
          message: `\`${params.kind}\` names \`${name}\`, but \`${name}\` was already joined or cancelled.`,
          path,
          details: {step: name},
        }),
      );
      continue;
    }
    if (!targets.includes(target)) targets.push(target);
  }
  return targets.sort((left, right) => left - right);
}

function validateBackgroundStep(params: {
  entry: ExpandedStep;
  at: (...field: WorkflowModelValidationIssuePathSegment[]) => StepPath;
  issues: WorkflowModelValidationIssue[];
}): void {
  const {entry, issues} = params;
  if (entry.viaParallel) return;
  if (entry.step.key === undefined) {
    issues.push(
      issue({
        code: 'background-key-required',
        message: 'A background step needs a `key` so `wait` and `cancel` can name it.',
        path: params.at('background'),
      }),
    );
  }
  if (entry.step.gate !== undefined) {
    issues.push(
      issue({
        code: 'concurrent-step-gate-unsupported',
        message: 'A gate cannot be used on a background or parallel step.',
        path: params.at('gate'),
      }),
    );
  }
}

// A step that blocks the next one. Background steps may be running next to it.
function validateSequentialStep(params: {
  step: WorkflowDocumentStep;
  entries: readonly ExpandedStep[];
  outstanding: ReadonlySet<number>;
  latestIndexByKey: ReadonlyMap<string, number>;
  at: (...field: WorkflowModelValidationIssuePathSegment[]) => StepPath;
  issues: WorkflowModelValidationIssue[];
}): void {
  const {step, outstanding, issues} = params;
  if (step.checkout !== undefined && outstanding.size > 0) {
    issues.push(
      issue({
        code: 'checkout-while-background-running',
        message: 'A checkout step cannot run while background steps run. Add `wait_all` before it.',
        path: params.at('checkout'),
      }),
    );
  }
  validateGateRestarts(params);
}

function validateGateRestarts(params: {
  step: WorkflowDocumentStep;
  entries: readonly ExpandedStep[];
  outstanding: ReadonlySet<number>;
  latestIndexByKey: ReadonlyMap<string, number>;
  at: (...field: WorkflowModelValidationIssuePathSegment[]) => StepPath;
  issues: WorkflowModelValidationIssue[];
}): void {
  const onFailure = params.step.gate?.on_failure;
  if (onFailure === undefined) return;
  const rules = Array.isArray(onFailure) ? onFailure : [onFailure];
  for (const [ruleIndex, rule] of rules.entries()) {
    const restartIndex = params.latestIndexByKey.get(rule.restart_from);
    if (restartIndex === undefined) continue;
    const path = params.at('gate', 'on_failure', ...(Array.isArray(onFailure) ? [ruleIndex] : []));
    const message = restartProblem({...params, restartIndex, restartFrom: rule.restart_from});
    if (message === undefined) continue;
    params.issues.push(
      issue({
        code: message.code,
        message: message.text,
        path,
        details: {restartFrom: rule.restart_from, step: message.step},
      }),
    );
  }
}

// A restart resets every step at or after its target, so it cannot start in the middle of a
// `parallel` block, which runs as one group, or leave a background step running that it would reset.
function restartProblem(params: {
  entries: readonly ExpandedStep[];
  outstanding: ReadonlySet<number>;
  restartIndex: number;
  restartFrom: string;
}):
  | {
      code: 'gate-restart-inside-parallel-block' | 'gate-restart-past-background-step';
      text: string;
      step: string;
    }
  | undefined {
  const target = params.entries[params.restartIndex];
  const groupStart =
    target?.viaParallel === true
      ? params.entries.findIndex((entry) => entry.parallelGroup === target.parallelGroup)
      : params.restartIndex;
  if (groupStart !== params.restartIndex) {
    return {
      code: 'gate-restart-inside-parallel-block',
      text: `\`restart_from\` cannot name \`${params.restartFrom}\`, a step in the middle of a \`parallel\` block. Restart from the first step of the block.`,
      step: params.restartFrom,
    };
  }
  const running = [...params.outstanding].find((candidate) => candidate >= params.restartIndex);
  if (running === undefined) return undefined;
  const name = params.entries[running]?.step.key ?? params.restartFrom;
  return {
    code: 'gate-restart-past-background-step',
    text: `\`restart_from\` cannot go back past \`${name}\`, which may still be running here.`,
    step: name,
  };
}

function closeJob(params: {
  entries: readonly ExpandedStep[];
  controls: Map<number, ConcurrentStepControl>;
  joinedBy: Map<number, number>;
  outstanding: ReadonlySet<number>;
  jobId: string;
}): {
  entries: readonly ExpandedStep[];
  controls: ReadonlyMap<number, ConcurrentStepControl>;
  joinedBy: ReadonlyMap<number, number>;
} {
  if (params.outstanding.size === 0) return params;
  const closing = [...params.outstanding].sort((left, right) => left - right);
  const index = params.entries.length;
  const lastTop = params.entries.at(-1)?.topIndex ?? 0;
  params.controls.set(index, {
    kind: 'wait',
    targets: closing.map((target) =>
      jobStepId({
        jobId: params.jobId,
        index: target,
        key: params.entries[target]?.step.key,
      }),
    ),
    origin: 'end-of-job',
  });
  for (const target of closing) params.joinedBy.set(target, index);
  return {
    entries: [
      ...params.entries,
      {
        step: {},
        path: ['steps', lastTop],
        topIndex: lastTop,
        synthetic: 'end-of-job',
        background: false,
        viaParallel: false,
      },
    ],
    controls: params.controls,
    joinedBy: params.joinedBy,
  };
}

function buildPlan(params: {
  entries: readonly ExpandedStep[];
  controls: ReadonlyMap<number, ConcurrentStepControl>;
  joinedBy: ReadonlyMap<number, number>;
  cancelledBy: ReadonlyMap<number, number>;
}): JobConcurrencyPlan {
  const {entries, joinedBy, cancelledBy} = params;
  return {
    ...params,
    hasBackground: entries.some((entry) => entry.background),
    isReadable(candidate, at) {
      if (candidate >= at) return false;
      if (entries[candidate]?.background !== true) return true;
      const joined = joinedBy.get(candidate);
      return joined !== undefined && joined < at;
    },
    windowEnd(index) {
      if (entries[index]?.background !== true) return index;
      return joinedBy.get(index) ?? cancelledBy.get(index) ?? entries.length;
    },
  };
}

/**
 * Points an issue at the document. Normalization reports a step by its index in the expanded
 * list, which differs from the document index once a job has a `parallel` block.
 */
export function remapExpandedIssuePath(params: {
  issue: WorkflowModelValidationIssue;
  sourceName: string;
  entries: readonly ExpandedStep[];
}): WorkflowModelValidationIssue {
  const [root, jobName, steps, index, ...rest] = params.issue.path;
  if (root !== 'jobs' || jobName !== params.sourceName || steps !== 'steps') return params.issue;
  if (typeof index !== 'number') return params.issue;
  const entry = params.entries[index];
  if (entry === undefined) return params.issue;
  return {...params.issue, path: ['jobs', jobName, ...entry.path, ...rest]};
}

const MISSING_STEP_PATTERN = /No such key: ([^\n]+)/u;

/**
 * An expression that reads a background step before its join fails with the generic missing key
 * reason, because the step is left out of its context. This names the cause on those issues.
 */
export function explainUnreadableStepReads(params: {
  issues: WorkflowModelValidationIssue[];
  sourceName: string;
  plan: JobConcurrencyPlan;
}): void {
  const {entries} = params.plan;
  if (!entries.some((entry) => entry.background)) return;
  for (const [position, current] of params.issues.entries()) {
    const [root, jobName, area, index] = current.path;
    if (root !== 'jobs' || jobName !== params.sourceName) continue;
    const at = area === 'steps' && typeof index === 'number' ? index : entries.length;
    const reason = current.details?.reason;
    const name = typeof reason === 'string' ? MISSING_STEP_PATTERN.exec(reason)?.[1] : undefined;
    if (name === undefined) continue;
    const unreadable = entries.some(
      (entry, candidate) =>
        entry.background && entry.step.key === name && !params.plan.isReadable(candidate, at),
    );
    if (!unreadable) continue;
    params.issues[position] = {
      ...current,
      details: {
        ...current.details,
        reason: `${reason}\n\n\`steps.${name}\` is not available here. Background steps are readable after a \`wait\` that joins them.`,
      },
    };
  }
}

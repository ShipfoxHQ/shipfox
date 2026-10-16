import type {StepListModel} from '#components/step-list/step-list-model.js';
import {
  type Job,
  type JobExecution,
  resolveJobExecution,
  resolveStepAttempt,
  type Step,
  type StepAttempt,
} from '#core/workflow-run.js';
import type {WorkflowJobSearch} from '#routes/inputs.js';

export interface ResolvedWorkflowJobSelection {
  jobExecution: JobExecution | undefined;
  step: Step | undefined;
  attempt: StepAttempt | undefined;
  selectedAttemptId: string | null;
}

export interface WorkflowJobLandingSelection {
  stepId: string;
  attemptId: string;
}

/**
 * Resolves job-scoped URL state. A valid step is authoritative over an execution id because a
 * step carries its owning execution. A step from another job is ignored and falls back to the
 * job's default execution rather than following a mangled URL into a different job.
 */
export function resolveWorkflowJobSelection({
  job,
  selection,
}: {
  job: Job;
  selection: WorkflowJobSearch;
}): ResolvedWorkflowJobSelection {
  const step = selection.stepId ? findStep(job, selection.stepId) : undefined;
  if (step) {
    const attempt = resolveStepAttempt(step, selection.stepAttemptId);
    const jobExecution = job.jobExecutions.find(
      (candidate) => candidate.id === step.jobExecutionId,
    );
    return {
      jobExecution: jobExecution ?? resolveJobExecution(job, undefined),
      step,
      attempt,
      selectedAttemptId: attempt?.id ?? null,
    };
  }

  return {
    jobExecution: selection.stepId
      ? resolveJobExecution(job, undefined)
      : resolveJobExecution(job, selection.jobExecutionId),
    step: undefined,
    attempt: undefined,
    selectedAttemptId: null,
  };
}

/**
 * Picks the running step the page follows, then the first failed step that counts for the job
 * result, for the first useful page state.
 */
export function workflowJobLandingSelection({
  jobExecution,
  stepListModel,
}: {
  jobExecution: JobExecution | undefined;
  stepListModel: StepListModel;
}): WorkflowJobLandingSelection | undefined {
  if (!jobExecution) return undefined;

  const runningEntry = stepListModel.entries.find(
    (entry) => entry.id === stepListModel.activeEntryId,
  );
  const running = runningEntry ? {step: runningEntry.step, attempt: runningEntry} : undefined;
  const failedStep = innermostFailedStep([...jobExecution.steps].sort(compareSteps));
  const failedAttempt = failedStep ? resolveStepAttempt(failedStep, undefined) : undefined;
  const failed =
    failedStep && failedAttempt ? {step: failedStep, attempt: failedAttempt} : undefined;
  const selected = running ?? failed;
  return selected ? {stepId: selected.step.id, attemptId: selected.attempt.id} : undefined;
}

/** A failed composite points at the inner step that failed it, when one did. */
function innermostFailedStep(sortedSteps: readonly Step[]): Step | undefined {
  let failed = sortedSteps.find(countedFailure);
  while (failed?.type === 'composite') {
    const parentId: string = failed.id;
    const failedChild = sortedSteps.find(
      (step) => step.parentStepId === parentId && countedFailure(step),
    );
    if (!failedChild) break;
    failed = failedChild;
  }
  return failed;
}

// A failure that leaves the job result unchanged is not where the page should open.
function countedFailure(step: Step): boolean {
  return step.status === 'failed' && step.affectsJob !== false;
}

function findStep(job: Job, stepId: string): Step | undefined {
  for (const execution of job.jobExecutions) {
    const step = execution.steps.find((candidate) => candidate.id === stepId);
    if (step) return step;
  }
  return undefined;
}

function compareSteps(left: Step, right: Step): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

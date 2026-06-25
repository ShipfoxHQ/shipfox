import type {
  WorkflowJob,
  WorkflowRunDetail,
  WorkflowStep,
  WorkflowStepAttempt,
} from '#core/workflow-run.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';

export interface ResolvedWorkflowRunSelection {
  job: WorkflowJob | undefined;
  step: WorkflowStep | undefined;
  attempt: WorkflowStepAttempt | undefined;
  selectedAttemptId: string | null;
}

export function resolveWorkflowRunSelection({
  run,
  selection,
}: {
  run: WorkflowRunDetail;
  selection: WorkflowRunSelectionInput;
}): ResolvedWorkflowRunSelection {
  const jobById = new Map(run.jobs.map((job) => [job.id, job]));
  const stepMatch = findStep(run, selection.stepId);

  if (stepMatch) {
    const attempt = resolveStepAttempt(stepMatch.step, selection.attemptId);
    return {
      job: stepMatch.job,
      step: stepMatch.step,
      attempt,
      selectedAttemptId: attempt?.id ?? null,
    };
  }

  return {
    job: (selection.jobId ? jobById.get(selection.jobId) : undefined) ?? run.jobs.at(0),
    step: undefined,
    attempt: undefined,
    selectedAttemptId: null,
  };
}

function findStep(
  run: WorkflowRunDetail,
  stepId: string | undefined,
): {job: WorkflowJob; step: WorkflowStep} | undefined {
  if (!stepId) return undefined;

  for (const job of run.jobs) {
    const step = job.steps.find((candidate) => candidate.id === stepId);
    if (step) return {job, step};
  }

  return undefined;
}

function resolveStepAttempt(
  step: WorkflowStep,
  attemptId: string | undefined,
): WorkflowStepAttempt | undefined {
  const attemptById = attemptId
    ? step.attempts.find((attempt) => attempt.id === attemptId)
    : undefined;
  if (attemptById) return attemptById;

  const currentAttempt = step.attempts.find((attempt) => attempt.attempt === step.currentAttempt);
  if (currentAttempt) return currentAttempt;

  return step.attempts.reduce<WorkflowStepAttempt | undefined>((latest, attempt) => {
    if (!latest) return attempt;
    return compareAttempts(attempt, latest) > 0 ? attempt : latest;
  }, undefined);
}

function compareAttempts(left: WorkflowStepAttempt, right: WorkflowStepAttempt): number {
  return (
    left.attempt - right.attempt ||
    left.executionOrder - right.executionOrder ||
    left.id.localeCompare(right.id)
  );
}

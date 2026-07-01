import type {Job, JobExecution, Step, StepAttempt, WorkflowRunDetail} from '#core/workflow-run.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';

export interface ResolvedWorkflowRunSelection {
  job: Job | undefined;
  jobExecution: JobExecution | undefined;
  step: Step | undefined;
  attempt: StepAttempt | undefined;
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
    const attempt = resolveStepAttempt(stepMatch.step, selection.stepAttemptId);
    return {
      job: stepMatch.job,
      jobExecution: stepMatch.jobExecution,
      step: stepMatch.step,
      attempt,
      selectedAttemptId: attempt?.id ?? null,
    };
  }

  const job = (selection.jobId ? jobById.get(selection.jobId) : undefined) ?? run.jobs.at(0);
  const jobExecution = job ? resolveJobExecution(job, selection.jobExecutionId) : undefined;

  return {
    job,
    jobExecution,
    step: undefined,
    attempt: undefined,
    selectedAttemptId: null,
  };
}

function findStep(
  run: WorkflowRunDetail,
  stepId: string | undefined,
): {job: Job; jobExecution: JobExecution; step: Step} | undefined {
  if (!stepId) return undefined;

  for (const job of run.jobs) {
    for (const jobExecution of job.jobExecutions) {
      const step = jobExecution.steps.find((candidate) => candidate.id === stepId);
      if (step) return {job, jobExecution, step};
    }
  }

  return undefined;
}

export function resolveJobExecution(
  job: Job,
  jobExecutionId: string | undefined,
): JobExecution | undefined {
  const selectedExecution = jobExecutionId
    ? job.jobExecutions.find((jobExecution) => jobExecution.id === jobExecutionId)
    : undefined;
  if (selectedExecution) return selectedExecution;

  const runningExecution = job.jobExecutions.find(
    (jobExecution) => jobExecution.status === 'running',
  );
  if (runningExecution) return runningExecution;

  return job.jobExecutions.reduce<JobExecution | undefined>((latest, jobExecution) => {
    if (!latest) return jobExecution;
    return jobExecution.sequence > latest.sequence ? jobExecution : latest;
  }, undefined);
}

function resolveStepAttempt(step: Step, attemptId: string | undefined): StepAttempt | undefined {
  const attemptById = attemptId
    ? step.attempts.find((attempt) => attempt.id === attemptId)
    : undefined;
  if (attemptById) return attemptById;

  const currentAttempt = step.attempts.find((attempt) => attempt.attempt === step.currentAttempt);
  if (currentAttempt) return currentAttempt;

  return step.attempts.reduce<StepAttempt | undefined>((latest, attempt) => {
    if (!latest) return attempt;
    return compareAttempts(attempt, latest) > 0 ? attempt : latest;
  }, undefined);
}

function compareAttempts(left: StepAttempt, right: StepAttempt): number {
  return (
    left.attempt - right.attempt ||
    left.executionOrder - right.executionOrder ||
    left.id.localeCompare(right.id)
  );
}

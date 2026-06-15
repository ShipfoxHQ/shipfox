import type {RunDetailDto, RunDto} from '@shipfox/api-workflows-dto';
import type {Job} from '#core/entities/job.js';
import type {Step, StepAttempt} from '#core/entities/step.js';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {toJobDto} from './job.js';
import {toStepAttemptDto, toStepDto} from './step.js';

export function toRunDto(run: WorkflowRun): RunDto {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    name: run.name,
    status: run.status,
    trigger_source: run.triggerSource,
    trigger_event: run.triggerEvent,
    trigger_payload: run.triggerPayload,
    inputs: run.inputs,
    duration_ms: 0,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
  };
}

export function toRunDetailDto({
  run,
  jobs,
  steps,
  attempts,
}: {
  run: WorkflowRun;
  jobs: Job[];
  steps: Step[];
  attempts: StepAttempt[];
}): RunDetailDto {
  const attemptsByStepId = new Map<string, StepAttempt[]>();
  for (const attempt of attempts) {
    const existing = attemptsByStepId.get(attempt.stepId) ?? [];
    existing.push(attempt);
    attemptsByStepId.set(attempt.stepId, existing);
  }

  const stepsByJobId = new Map<string, Step[]>();
  for (const step of steps) {
    const existing = stepsByJobId.get(step.jobId) ?? [];
    existing.push(step);
    stepsByJobId.set(step.jobId, existing);
  }

  return {
    ...toRunDto(run),
    workflow_source_yaml: run.definitionSnapshot?.sourceYaml ?? null,
    workflow_document: run.definitionSnapshot?.document ?? null,
    workflow_model: run.definitionSnapshot?.model ?? null,
    jobs: jobs.map((job) => ({
      ...toJobDto(job),
      steps: (stepsByJobId.get(job.id) ?? []).map((step) => ({
        ...toStepDto(step),
        attempts: (attemptsByStepId.get(step.id) ?? []).map(toStepAttemptDto),
      })),
    })),
  };
}

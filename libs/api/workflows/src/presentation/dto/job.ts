import type {JobDto, JobExecutionDto} from '@shipfox/api-workflows-dto';
import type {Job} from '#core/entities/job.js';
import type {JobExecution} from '#core/entities/job-execution.js';

export function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    run_id: job.runId,
    name: job.name,
    status: job.status,
    status_reason: job.statusReason,
    carried_over: job.carriedOver,
    dependencies: job.dependencies,
    position: job.position,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    queued_at: job.queuedAt?.toISOString() ?? null,
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null,
  };
}

export function toJobExecutionDto(execution: JobExecution): JobExecutionDto {
  return {
    id: execution.id,
    job_id: execution.jobId,
    run_id: execution.runId,
    sequence: execution.sequence,
    name: execution.name,
    status: execution.status,
    status_reason: execution.statusReason,
    queued_at: execution.queuedAt?.toISOString() ?? null,
    started_at: execution.startedAt?.toISOString() ?? null,
    finished_at: execution.finishedAt?.toISOString() ?? null,
    timed_out_at: execution.timedOutAt?.toISOString() ?? null,
    created_at: execution.createdAt.toISOString(),
    updated_at: execution.updatedAt.toISOString(),
  };
}

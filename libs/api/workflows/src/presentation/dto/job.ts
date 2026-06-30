import type {JobDto, JobExecutionDto} from '@shipfox/api-workflows-dto';
import {type Job, type JobDuration, jobDurationFor} from '#core/entities/job.js';
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
    duration: toJobDurationDto(jobDurationFor(job)),
  };
}

function toJobDurationDto(duration: JobDuration): JobDto['duration'] {
  switch (duration.kind) {
    case 'none':
      return {kind: 'none'};
    case 'queued':
      return {kind: 'queued', from_iso: duration.from.toISOString()};
    case 'running':
      return {kind: 'running', from_iso: duration.from.toISOString()};
    case 'finished':
      return {
        kind: 'finished',
        from_iso: duration.from.toISOString(),
        to_iso: duration.to.toISOString(),
      };
    default: {
      const exhaustive: never = duration;
      return exhaustive;
    }
  }
}

export function toJobExecutionDto(jobExecution: JobExecution): JobExecutionDto {
  return {
    id: jobExecution.id,
    job_id: jobExecution.jobId,
    sequence: jobExecution.sequence,
    name: jobExecution.name,
    status: jobExecution.status,
    status_reason: jobExecution.statusReason,
    queued_at: jobExecution.queuedAt?.toISOString() ?? null,
    started_at: jobExecution.startedAt?.toISOString() ?? null,
    finished_at: jobExecution.finishedAt?.toISOString() ?? null,
    timed_out_at: jobExecution.timedOutAt?.toISOString() ?? null,
    created_at: jobExecution.createdAt.toISOString(),
    updated_at: jobExecution.updatedAt.toISOString(),
  };
}

import type {JobDto} from '@shipfox/api-workflows-dto';
import {type Job, type JobDuration, jobDurationFor} from '#core/entities/job.js';

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

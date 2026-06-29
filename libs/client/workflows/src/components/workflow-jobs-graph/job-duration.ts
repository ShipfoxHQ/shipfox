import {isTerminalJobStatus, type WorkflowJob} from '#core/workflow-run.js';

/**
 * Which duration a job node shows, and how. Derived purely from the job's
 * lifecycle timestamps and status — no `now`. Live phases (`queued`, `running`)
 * carry the anchor the component ticks against; `finished` carries a stored span.
 *
 * Honest-UI: `none` covers every case where no real duration exists — a job that
 * never executed (`skipped`, or cancelled before dispatch), a terminal job whose
 * `finishedAt` never landed, and the eventual-consistency window before the
 * runner queue/claim events project `queuedAt`/`startedAt` onto the row.
 */
export type JobDurationDisplay =
  | {kind: 'none'}
  | {kind: 'queued'; fromIso: string}
  | {kind: 'running'; fromIso: string}
  | {kind: 'finished'; fromIso: string; toIso: string};

export function jobDurationDisplay(
  job: Pick<WorkflowJob, 'status' | 'queuedAt' | 'startedAt' | 'finishedAt'>,
): JobDurationDisplay {
  const {status, queuedAt, startedAt, finishedAt} = job;
  const terminal = isTerminalJobStatus(status);

  if (startedAt !== null) {
    if (finishedAt !== null) return {kind: 'finished', fromIso: startedAt, toIso: finishedAt};
    if (!terminal) return {kind: 'running', fromIso: startedAt};
    // Terminal without a finish timestamp (crash/lag): a live clock would be wrong
    // and a span is unknown, so show nothing.
    return {kind: 'none'};
  }

  // Never started executing.
  if (terminal) return {kind: 'none'};
  if (queuedAt !== null) return {kind: 'queued', fromIso: queuedAt};
  return {kind: 'none'};
}

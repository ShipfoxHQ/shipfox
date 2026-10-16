const STEP_CANCEL_ABORT_NAME = 'StepCancelled';

/**
 * The reason a step's signal is aborted with when the server stops that one step. A job-wide abort
 * carries another reason, so a process stops gracefully on a cancel and at once on a job abort.
 * Matched by name, since the reason crosses package copies.
 */
export const STEP_CANCEL_ABORT_REASON: Error = Object.assign(new Error('The step was cancelled.'), {
  name: STEP_CANCEL_ABORT_NAME,
});

/** Whether `signal` was aborted to stop one step, not the whole job. */
export function isStepCancelAbort(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  const {reason} = signal;
  return reason instanceof Error && reason.name === STEP_CANCEL_ABORT_NAME;
}

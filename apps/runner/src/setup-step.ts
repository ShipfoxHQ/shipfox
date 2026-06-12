import type {StepResult} from '#run-step.js';
import {createJobDir} from '#workspace.js';

// The synthetic "Set up job" step body. Today it owns workspace preparation; the
// repository checkout (and the `git` precondition it needs) plug in here with
// ENG-405, reporting `checkout_*` / `git_unavailable` reasons through the same
// StepResult shape. Failures are reported through the normal step protocol, so a
// setup failure fails the job in seconds instead of hanging until the lease
// expires.
//
// Abort handling lives in the step loop, not here: an aborted job stops the loop
// before it reports (see step-loop.ts), exactly like an abort during any step.
export async function executeSetupStep(params: {cwd: string}): Promise<StepResult> {
  try {
    await createJobDir(params.cwd);
  } catch (error) {
    return {
      success: false,
      output: '',
      error: {
        message: error instanceof Error ? error.message : String(error),
        reason: 'workspace_prep_failed',
      },
      exit_code: null,
    };
  }

  return {success: true, output: '', error: null, exit_code: 0};
}

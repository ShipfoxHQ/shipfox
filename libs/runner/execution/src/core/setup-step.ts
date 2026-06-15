import {createJobDir} from '@shipfox/runner-workspace';
import type {StepResult} from '#core/step-result.js';

// The synthetic "Set up job" step body. It owns per-job workspace preparation and
// reports failures through the normal step protocol, so a setup failure fails the
// job in seconds instead of hanging until the lease expires.
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

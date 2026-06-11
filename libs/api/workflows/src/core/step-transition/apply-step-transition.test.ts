import type {Tx} from '#db/db.js';
import {applyStepTransition} from './apply-step-transition.js';
import type {StepTransitionDecision} from './decide-step-transition.js';

// The restart kinds throw before touching the transaction, so a stub tx is safe.
const tx = {} as Tx;
const ctx = {jobId: 'job-1', result: {status: 'failed' as const}};

describe('applyStepTransition unsupported decisions', () => {
  test('restart-job-from-step throws until durable restart lands (PR E)', async () => {
    const decision: StepTransitionDecision = {
      kind: 'restart-job-from-step',
      failedStepId: 's1',
      restartFromStepId: 's0',
      attempt: 1,
      reason: 'gate failed',
    };

    await expect(applyStepTransition(decision, ctx, tx)).rejects.toThrow(
      'Unsupported step transition',
    );
  });

  test('fail-job-restart-exhausted throws until durable restart lands (PR E)', async () => {
    const decision: StepTransitionDecision = {
      kind: 'fail-job-restart-exhausted',
      failedStepId: 's1',
      attempt: 3,
      maxAttempts: 3,
    };

    await expect(applyStepTransition(decision, ctx, tx)).rejects.toThrow(
      'Unsupported step transition',
    );
  });
});

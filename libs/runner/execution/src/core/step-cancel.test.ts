import {isStepCancelAbort, STEP_CANCEL_ABORT_REASON} from '#core/step-cancel.js';

describe('isStepCancelAbort', () => {
  it('recognizes a signal aborted with the cancel reason', () => {
    const controller = new AbortController();

    controller.abort(STEP_CANCEL_ABORT_REASON);

    expect(isStepCancelAbort(controller.signal)).toBe(true);
  });

  it('recognizes the reason by name, as copies of the module hold different instances', () => {
    const controller = new AbortController();
    const copy = Object.assign(new Error('The step was cancelled.'), {
      name: STEP_CANCEL_ABORT_REASON.name,
    });

    controller.abort(copy);

    expect(isStepCancelAbort(controller.signal)).toBe(true);
  });

  it('does not take a job-wide abort for a cancel', () => {
    const controller = new AbortController();

    controller.abort();

    expect(isStepCancelAbort(controller.signal)).toBe(false);
    expect(isStepCancelAbort(undefined)).toBe(false);
  });

  it('does not take a signal that did not abort for a cancel', () => {
    expect(isStepCancelAbort(new AbortController().signal)).toBe(false);
  });
});

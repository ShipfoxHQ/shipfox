import {ApiError} from '@shipfox/client-api';
import {classifyClickUpCallbackError} from './clickup-form-errors.js';

describe('classifyClickUpCallbackError', () => {
  it.each([
    ['invalid-clickup-install-state', 'ClickUp install link expired', true, false],
    ['clickup-install-state-actor-mismatch', 'Different Shipfox account', true, true],
    ['clickup-installation-already-linked', 'ClickUp already linked', false, false],
    ['clickup-connection-already-linked', 'ClickUp already linked', false, false],
    ['clickup-workspace-count', 'One ClickUp workspace required', true, false],
    ['clickup-oauth-callback-error', 'ClickUp permissions needed', true, false],
    ['provider-unavailable', 'ClickUp is temporarily unavailable', true, false],
    ['network-error', 'Could not reach Shipfox', true, false],
  ])('maps %s to a recoverable form state', (code, title, startOver, signIn) => {
    const failure = classifyClickUpCallbackError(
      new ApiError({code, message: 'request failed', status: 400}),
    );

    expect(failure.title).toBe(title);
    expect(failure.startOver).toBe(startOver);
    expect(failure.signIn).toBe(signIn);
  });

  it('explains that exactly one workspace must be authorized', () => {
    const failure = classifyClickUpCallbackError(
      new ApiError({code: 'clickup-workspace-count', message: 'ambiguous', status: 422}),
    );

    expect(failure.message).toContain('exactly one ClickUp workspace');
    expect(failure.message).toContain('start the install again');
  });

  it('uses the generic recovery for unexpected errors', () => {
    expect(classifyClickUpCallbackError(new Error('network down'))).toEqual({
      title: 'ClickUp install could not be completed',
      message: 'Could not complete the ClickUp install. Start again from workspace settings.',
      startOver: true,
      signIn: false,
    });
  });
});

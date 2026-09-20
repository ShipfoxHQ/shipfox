import {ApiError} from '@shipfox/client-api';
import {classifyNotionCallbackError} from './notion-form-errors.js';

describe('classifyNotionCallbackError', () => {
  it.each([
    ['invalid-notion-install-state', 'Notion install link expired', true, false],
    ['notion-install-state-actor-mismatch', 'Different Shipfox account', true, true],
    ['notion-installation-already-linked', 'Notion already linked', false, false],
    ['notion-connection-already-linked', 'Notion already linked', false, false],
    ['notion-oauth-callback-error', 'Notion access was not granted', true, false],
    ['notion-access-denied', 'Notion access was not granted', true, false],
    ['provider-unavailable', 'Notion is temporarily unavailable', true, false],
    ['network-error', 'Could not reach Shipfox', true, false],
  ])('maps %s to a recoverable form state', (code, title, startOver, signIn) => {
    const failure = classifyNotionCallbackError(
      new ApiError({code, message: 'request failed', status: 400}),
    );

    expect(failure.title).toBe(title);
    expect(failure.startOver).toBe(startOver);
    expect(failure.signIn).toBe(signIn);
  });

  it('uses neutral copy for access denied outcomes', () => {
    const failure = classifyNotionCallbackError(
      new ApiError({code: 'access-denied', message: 'denied', status: 403}),
    );

    expect(failure.message).toContain('cancelled');
    expect(failure.message).toContain('workspace restricts connections');
    expect(failure.message).not.toContain('permissions needed');
  });

  it('uses the generic recovery for unexpected errors', () => {
    expect(classifyNotionCallbackError(new Error('network down'))).toEqual({
      title: 'Notion install could not be completed',
      message: 'Could not complete the Notion install. Start again from workspace settings.',
      startOver: true,
      signIn: false,
    });
  });
});

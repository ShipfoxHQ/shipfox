import {ApiError} from '@shipfox/client-api';
import {classifyDiscordCallbackError} from './discord-form-errors.js';

describe('classifyDiscordCallbackError', () => {
  it.each([
    ['invalid-discord-install-state', 'Discord install link expired', true, false],
    ['discord-install-state-actor-mismatch', 'Different Shipfox account', true, true],
    ['discord-installation-already-linked', 'Discord server already linked', false, false],
    ['discord-connection-already-linked', 'Discord server already linked', false, false],
    ['discord-oauth-callback-error', 'Discord access was not granted', true, false],
    ['discord-bot-not-in-guild', 'Discord bot was not installed', true, false],
    ['discord-access-denied', 'Discord access was not granted', true, false],
    ['provider-unavailable', 'Discord is temporarily unavailable', true, false],
    ['network-error', 'Could not reach Shipfox', true, false],
  ])('maps %s to a recoverable form state', (code, title, startOver, signIn) => {
    const failure = classifyDiscordCallbackError(
      new ApiError({code, message: 'request failed', status: 400}),
    );

    expect(failure.title).toBe(title);
    expect(failure.startOver).toBe(startOver);
    expect(failure.signIn).toBe(signIn);
  });

  it('uses neutral copy for access denied outcomes', () => {
    const failure = classifyDiscordCallbackError(
      new ApiError({code: 'access-denied', message: 'denied', status: 403}),
    );

    expect(failure.message).toContain('cancelled');
    expect(failure.message).toContain('server install was not approved');
    expect(failure.message).not.toContain('permissions needed');
  });

  it('uses generic recovery for unauthorized sessions', () => {
    expect(
      classifyDiscordCallbackError(
        new ApiError({code: 'unauthorized', message: 'session expired', status: 401}),
      ),
    ).toEqual({
      title: 'Discord install could not be completed',
      message: 'Could not complete the Discord install. Start again from workspace settings.',
      startOver: true,
      signIn: false,
    });
  });

  it('uses the generic recovery for unexpected errors', () => {
    expect(classifyDiscordCallbackError(new Error('network down'))).toEqual({
      title: 'Discord install could not be completed',
      message: 'Could not complete the Discord install. Start again from workspace settings.',
      startOver: true,
      signIn: false,
    });
  });
});

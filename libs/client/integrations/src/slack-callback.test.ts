import {ApiError} from '@shipfox/client-api';
import {
  classifySlackCallbackError,
  parseSlackCallbackQuery,
  serializeSlackCallbackQuery,
} from './slack-callback.js';

describe('Slack callback helpers', () => {
  it('parses and serializes callback input', () => {
    const query = parseSlackCallbackQuery({code: 'grant code', state: 'signed state'});
    expect(query).toEqual({code: 'grant code', state: 'signed state'});
    expect(query && serializeSlackCallbackQuery(query)).toBe('code=grant+code&state=signed+state');
    expect(parseSlackCallbackQuery({state: 'signed'})).toBeUndefined();
  });

  it.each([
    ['invalid-slack-install-state', 400, 'Slack install link expired', true],
    ['slack-install-state-actor-mismatch', 403, 'Different Shipfox account', true],
    ['forbidden', 403, 'Workspace access changed', false],
    ['workspace-inactive', 403, 'Workspace access changed', false],
    ['slack-installation-already-linked', 409, 'Slack already linked', false],
    ['slack-authorization-scope-mismatch', 422, 'Slack permissions needed', true],
    ['slack-enterprise-install-unsupported', 422, 'Slack install unsupported', false],
    ['network-error', 0, 'Could not reach Shipfox', true],
    ['rate-limited', 429, 'Slack is temporarily unavailable', true],
    ['unknown-error', 400, 'Slack install could not be completed', true],
  ])('classifies %s', (code, status, title, startOver) => {
    expect(
      classifySlackCallbackError(new ApiError({code, status, message: 'failed'})),
    ).toMatchObject({title, startOver});
  });
});

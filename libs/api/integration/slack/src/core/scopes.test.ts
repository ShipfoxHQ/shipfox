import {SlackAuthorizationScopeMismatchError} from './errors.js';
import {assertSlackAuthorizationScopes, formatSlackBotScopes, SLACK_BOT_SCOPES} from './scopes.js';

describe('Slack bot scopes', () => {
  it('formats and accepts the complete required scope set', () => {
    const result = () => assertSlackAuthorizationScopes([...SLACK_BOT_SCOPES]);

    expect(formatSlackBotScopes()).toBe(SLACK_BOT_SCOPES.join(','));
    expect(result).not.toThrow();
  });

  it('reports every missing scope', () => {
    const result = () => assertSlackAuthorizationScopes(['chat:write']);

    expect(result).toThrow(SlackAuthorizationScopeMismatchError);
    try {
      result();
    } catch (error) {
      expect(error).toMatchObject({missingScopes: expect.arrayContaining(['app_mentions:read'])});
    }
  });
});

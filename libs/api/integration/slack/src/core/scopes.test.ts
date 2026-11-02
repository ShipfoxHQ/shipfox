import {SlackAuthorizationScopeMismatchError} from './errors.js';
import {
  assertSlackAuthorizationScopes,
  formatSlackBotScopes,
  missingSlackBotScopes,
  SLACK_BOT_SCOPES,
} from './scopes.js';

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

  it('requests the scopes agents post and show in the agent view with', () => {
    const result = SLACK_BOT_SCOPES;

    expect(result).toEqual(expect.arrayContaining(['chat:write.customize', 'assistant:write']));
  });

  it('lists the scopes an older installation lacks', () => {
    const olderScopes = SLACK_BOT_SCOPES.filter(
      (scope) => scope !== 'chat:write.customize' && scope !== 'assistant:write',
    );

    const result = missingSlackBotScopes(olderScopes);

    expect(result).toEqual(['chat:write.customize', 'assistant:write']);
  });

  it('lists no scope for a complete grant', () => {
    const result = missingSlackBotScopes([...SLACK_BOT_SCOPES]);

    expect(result).toEqual([]);
  });
});

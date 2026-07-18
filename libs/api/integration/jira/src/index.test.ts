import {createJiraIntegrationProvider} from '#index.js';

describe('createJiraIntegrationProvider', () => {
  it('creates the minimal Jira provider', () => {
    const provider = createJiraIntegrationProvider();

    expect(provider).toEqual({provider: 'jira', displayName: 'Jira'});
  });
});

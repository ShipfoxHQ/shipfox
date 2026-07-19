import {createJiraIntegrationProvider} from '#index.js';

describe('createJiraIntegrationProvider', () => {
  it('creates the Jira provider', () => {
    const provider = createJiraIntegrationProvider();

    expect(provider).toMatchObject({
      provider: 'jira',
      displayName: 'Jira',
      adapters: {},
      routes: [],
    });
  });
});

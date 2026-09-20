import type {ConnectNotionInstallationInput} from './install.js';

describe('ConnectNotionInstallationInput', () => {
  it('keeps the seed connection contract type-only', () => {
    const input: ConnectNotionInstallationInput = {
      workspaceId: crypto.randomUUID(),
      notionWorkspaceId: crypto.randomUUID(),
      workspaceName: 'Acme',
      botId: crypto.randomUUID(),
      authorizedByUserId: crypto.randomUUID(),
      displayName: 'Notion Acme',
    };

    expect(input.displayName).toBe('Notion Acme');
  });
});

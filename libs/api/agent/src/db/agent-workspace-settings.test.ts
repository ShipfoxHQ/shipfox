import crypto from 'node:crypto';
import {getAgentWorkspaceSettings, setDefaultAgentProvider} from '#db/index.js';

describe('agent workspace settings', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('persists the workspace default provider', async () => {
    const settings = await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(settings);
    expect(found).toMatchObject({
      workspaceId,
      defaultProviderId: 'anthropic',
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates the workspace default provider', async () => {
    await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    const updated = await setDefaultAgentProvider({workspaceId, providerId: 'openai'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(updated);
    expect(found?.defaultProviderId).toBe('openai');
  });

  it('clears the workspace default provider', async () => {
    await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    await setDefaultAgentProvider({workspaceId, providerId: null});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found?.defaultProviderId).toBeNull();
  });

  it('returns undefined for a workspace without settings', async () => {
    const found = await getAgentWorkspaceSettings(workspaceId);

    expect(found).toBeUndefined();
  });
});

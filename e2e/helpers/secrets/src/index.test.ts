import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

const requestJson = vi.fn();

const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';

describe('secrets e2e helper', () => {
  beforeEach(() => {
    vi.resetModules();
    requestJson.mockReset();
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
  });

  it('creates secrets through the admin setup route', async () => {
    requestJson.mockResolvedValueOnce({key: 'API_TOKEN'});
    const {createSecret} = await import('./index.js');

    await createSecret({
      workspaceId,
      actorId,
      key: 'API_TOKEN',
      value: 'seeded-secret',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/secrets/secret', {
      json: {
        workspace_id: workspaceId,
        actor_id: actorId,
        key: 'API_TOKEN',
        value: 'seeded-secret',
      },
    });
  });

  it('creates variables through the admin setup route', async () => {
    requestJson.mockResolvedValueOnce({key: 'REGION'});
    const {createVariable} = await import('./index.js');

    await createVariable({
      workspaceId,
      actorId,
      projectId: '33333333-3333-4333-8333-333333333333',
      key: 'REGION',
      value: 'eu-west-1',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/secrets/variable', {
      json: {
        workspace_id: workspaceId,
        actor_id: actorId,
        project_id: '33333333-3333-4333-8333-333333333333',
        key: 'REGION',
        value: 'eu-west-1',
      },
    });
  });
});

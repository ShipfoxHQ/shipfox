import {
  claapConnectBodySchema,
  claapConnectResponseSchema,
  claapReplaceApiKeyBodySchema,
  createE2eClaapConnectionBodySchema,
} from './index.js';

describe('Claap DTOs', () => {
  it('accepts a connect body and a connect response without credentials', () => {
    expect(
      claapConnectBodySchema.parse({
        workspace_id: '00000000-0000-4000-8000-000000000003',
        api_key: 'cla_secret',
      }),
    ).toEqual({workspace_id: '00000000-0000-4000-8000-000000000003', api_key: 'cla_secret'});
    const response = {
      connection: {
        id: '00000000-0000-4000-8000-000000000001',
        workspace_id: '00000000-0000-4000-8000-000000000002',
        provider: 'claap',
        external_account_id: 'q2IqD9wUHb',
        slug: 'claap_mercateam',
        display_name: 'Claap Mercateam',
        lifecycle_status: 'active',
        capabilities: [],
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    };
    expect(claapConnectResponseSchema.parse(response)).toEqual(response);
    expect(claapReplaceApiKeyBodySchema.parse({api_key: 'cla_new'})).toEqual({api_key: 'cla_new'});
  });

  it('accepts an error lifecycle status for E2E setup', () => {
    expect(
      createE2eClaapConnectionBodySchema.parse({
        workspace_id: '00000000-0000-4000-8000-000000000003',
        api_key: 'cla_secret',
        claap_workspace_id: 'q2IqD9wUHb',
        claap_workspace_name: 'Mercateam',
        lifecycle_status: 'error',
      }),
    ).toMatchObject({lifecycle_status: 'error'});
  });
});

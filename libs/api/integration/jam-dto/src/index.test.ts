import {
  createE2eJamConnectionBodySchema,
  jamConnectBodySchema,
  jamConnectResponseSchema,
  jamReplaceTokenBodySchema,
} from './index.js';

describe('Jam DTOs', () => {
  it('accepts a connect body and a connect response without exposing credentials', () => {
    expect(
      jamConnectBodySchema.parse({
        workspace_id: '00000000-0000-4000-8000-000000000003',
        token: 'jam_pat_secret',
      }),
    ).toEqual({workspace_id: '00000000-0000-4000-8000-000000000003', token: 'jam_pat_secret'});
    const response = {
      connection: {
        id: '00000000-0000-4000-8000-000000000001',
        workspace_id: '00000000-0000-4000-8000-000000000002',
        provider: 'jam',
        external_account_id: 'team-1',
        slug: 'jam',
        display_name: 'Jam',
        lifecycle_status: 'active',
        capabilities: [],
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    };
    expect(jamConnectResponseSchema.parse(response)).toEqual(response);
    expect(jamReplaceTokenBodySchema.parse({token: 'jam_pat_new'})).toEqual({
      token: 'jam_pat_new',
    });
  });

  it('accepts an error lifecycle status for E2E setup', () => {
    expect(
      createE2eJamConnectionBodySchema.parse({
        workspace_id: '00000000-0000-4000-8000-000000000003',
        token: 'jam_pat_secret',
        team_id: 'team-1',
        user_id: 'user-1',
        user_name: 'Ada',
        lifecycle_status: 'error',
      }),
    ).toMatchObject({lifecycle_status: 'error'});
  });
});

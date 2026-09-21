import {
  posthogConnectRequestSchema,
  posthogConnectResponseSchema,
  posthogExternalAccountId,
  posthogReplaceApiKeyRequestSchema,
} from './index.js';

describe('PostHog DTOs', () => {
  it('accepts both connect response states without exposing credentials', () => {
    expect(
      posthogConnectRequestSchema.parse({
        workspace_id: '00000000-0000-4000-8000-000000000003',
        region: 'eu',
        api_key: 'phx_secret',
        project_id: 'project-1',
      }),
    ).toEqual({
      workspace_id: '00000000-0000-4000-8000-000000000003',
      region: 'eu',
      api_key: 'phx_secret',
      project_id: 'project-1',
    });
    const connectedResponse = {
      status: 'connected' as const,
      connection: {
        id: '00000000-0000-4000-8000-000000000001',
        workspace_id: '00000000-0000-4000-8000-000000000002',
        provider: 'posthog',
        external_account_id: 'eu:project-1',
        slug: 'posthog_analytics',
        display_name: 'Analytics',
        lifecycle_status: 'active',
        capabilities: [],
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    };
    expect(posthogConnectResponseSchema.parse(connectedResponse)).toEqual(connectedResponse);
    expect(
      posthogConnectResponseSchema.parse({
        status: 'select-project',
        projects: [{id: 'project-1', name: 'Analytics'}],
      }),
    ).toEqual({status: 'select-project', projects: [{id: 'project-1', name: 'Analytics'}]});
    expect(posthogReplaceApiKeyRequestSchema.parse({api_key: 'phx_new'})).toEqual({
      api_key: 'phx_new',
    });
  });

  it.each(['us', 'eu'] as const)('encodes %s project identity with its region', (region) => {
    expect(posthogExternalAccountId(region, 'project-1')).toBe(`${region}:project-1`);
  });
});

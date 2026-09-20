import {
  posthogConnectRequestSchema,
  posthogConnectResponseSchema,
  posthogReplaceApiKeyRequestSchema,
} from './index.js';

describe('PostHog DTOs', () => {
  it('accepts both connect response states without exposing credentials', () => {
    expect(
      posthogConnectRequestSchema.parse({api_key: 'phx_secret', project_id: 'project-1'}),
    ).toEqual({api_key: 'phx_secret', project_id: 'project-1'});
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
});

import {
  createE2eNotionConnectionBodySchema,
  createNotionInstallBodySchema,
  createNotionInstallResponseSchema,
  NOTION_PROVIDER,
  notionAgentToolIdSchema,
  notionAgentToolIds,
  notionCallbackOkResponseSchema,
  notionCallbackQuerySchema,
  notionCallbackResponseSchema,
  notionEventNameSchema,
  notionWebhookEnvelopeSchema,
  notionWebhookEventNames,
  notionWebhookHandshakeSchema,
  notionWebhookVerificationSchema,
} from '../index.js';

const webhookSample = {
  id: 'event-1',
  timestamp: '2026-09-18T15:00:00.000Z',
  workspace_id: 'notion-workspace-1',
  subscription_id: 'subscription-1',
  integration_id: 'integration-1',
  type: 'page.properties_updated',
  authors: [{id: 'person-1', type: 'person'}],
  accessible_by: [{id: 'bot-1', type: 'bot'}],
  attempt_number: 1,
  entity: {id: 'page-1', type: 'page'},
  data: {updated_properties: ['status']},
  provider_field: 'preserved',
};

const connection = {
  id: 'f1d4d8d6-7594-4b6a-8c4b-26f7f4c7fd8a',
  workspace_id: 'f1d4d8d6-7594-4b6a-8c4b-26f7f4c7fd8a',
  provider: 'notion',
  external_account_id: 'notion-workspace-1',
  slug: 'notion-acme',
  display_name: 'Acme Notion',
  lifecycle_status: 'active',
  capabilities: ['agent_tools'],
  created_at: '2026-09-18T15:00:00.000Z',
  updated_at: '2026-09-18T15:00:00.000Z',
};

describe('Notion provider and event vocabulary', () => {
  it('names the provider and excludes deprecated database events', () => {
    expect(NOTION_PROVIDER).toBe('notion');
    expect(notionWebhookEventNames).toHaveLength(21);
    expect(notionEventNameSchema.parse('data_source.schema_updated')).toBe(
      'data_source.schema_updated',
    );
    expect(notionEventNameSchema.safeParse('database.content_updated').success).toBe(false);
    expect(notionEventNameSchema.safeParse('database.schema_updated').success).toBe(false);
  });
});

describe('Notion webhook schemas', () => {
  it('accepts an event envelope and preserves provider fields', () => {
    const result = notionWebhookEnvelopeSchema.parse(webhookSample);

    expect(result.entity.id).toBe('page-1');
    expect(result.provider_field).toBe('preserved');
  });

  it('accepts a handshake token', () => {
    expect(notionWebhookVerificationSchema.parse({verification_token: 'secret_123'})).toEqual({
      verification_token: 'secret_123',
    });
    expect(notionWebhookHandshakeSchema.parse({verification_token: 'secret_123'})).toEqual({
      verification_token: 'secret_123',
    });
  });

  it.each([
    ['id', ''],
    ['timestamp', undefined],
    ['workspace_id', ''],
    ['subscription_id', undefined],
    ['integration_id', ''],
    ['type', 'page.unknown'],
    ['authors', []],
    ['attempt_number', 1.5],
    ['entity', {id: 'page-1', type: 'unknown'}],
    ['data', 'not-an-object'],
  ])('rejects an envelope with an invalid %s', (field, value) => {
    const result = notionWebhookEnvelopeSchema.safeParse({...webhookSample, [field]: value});

    expect(result.success).toBe(false);
  });

  it('allows a missing accessible_by field for fail-closed receiver handling', () => {
    const result = notionWebhookEnvelopeSchema.parse({...webhookSample, accessible_by: undefined});

    expect(result.accessible_by).toBeUndefined();
  });

  it('rejects a delivery attempt above the Notion retry limit', () => {
    const result = notionWebhookEnvelopeSchema.safeParse({...webhookSample, attempt_number: 9});

    expect(result.success).toBe(false);
  });

  it('rejects an agent from the grant visibility actors', () => {
    const result = notionWebhookEnvelopeSchema.safeParse({
      ...webhookSample,
      accessible_by: [{id: 'agent-1', type: 'agent'}],
    });

    expect(result.success).toBe(false);
  });
});

describe('Notion install and callback DTOs', () => {
  it('validates install requests and responses', () => {
    expect(
      createNotionInstallBodySchema.safeParse({workspace_id: connection.workspace_id}).success,
    ).toBe(true);
    expect(
      createNotionInstallResponseSchema.safeParse({
        install_url: 'https://api.notion.com/v1/oauth/authorize?state=signed',
      }).success,
    ).toBe(true);
    expect(createNotionInstallBodySchema.safeParse({workspace_id: 'not-a-uuid'}).success).toBe(
      false,
    );
    expect(createNotionInstallResponseSchema.safeParse({install_url: 'not-a-url'}).success).toBe(
      false,
    );
  });

  it('accepts OAuth success and denial callback queries', () => {
    expect(
      notionCallbackQuerySchema.parse({code: 'grant-code', state: 'signed-state'}),
    ).toMatchObject({code: 'grant-code'});
    expect(
      notionCallbackQuerySchema.parse({
        error: 'access_denied',
        error_description: 'The user denied access.',
        state: 'signed-state',
      }),
    ).toMatchObject({error: 'access_denied'});
    expect(notionCallbackQuerySchema.safeParse({code: 'grant-code'}).success).toBe(false);
  });

  it.each(['connected', 'reconnected'] as const)('accepts a %s callback outcome', (outcome) => {
    expect(notionCallbackResponseSchema.parse({outcome, connection})).toMatchObject({outcome});
    expect(notionCallbackOkResponseSchema.parse({outcome, connection})).toMatchObject({outcome});
  });

  it.each([
    'access_denied',
    'already-linked',
    'state-invalid',
    'provider-unavailable',
  ] as const)('accepts the %s callback outcome', (outcome) => {
    expect(notionCallbackResponseSchema.parse({outcome})).toEqual({outcome});
  });

  it('limits HTTP 200 callback responses to reachable outcomes', () => {
    expect(notionCallbackOkResponseSchema.parse({outcome: 'access_denied'})).toEqual({
      outcome: 'access_denied',
    });
    expect(notionCallbackOkResponseSchema.safeParse({outcome: 'already-linked'}).success).toBe(
      false,
    );
    expect(notionCallbackOkResponseSchema.safeParse({outcome: 'state-invalid'}).success).toBe(
      false,
    );
    expect(
      notionCallbackOkResponseSchema.safeParse({outcome: 'provider-unavailable'}).success,
    ).toBe(false);
  });

  it('rejects a callback response without its required connection', () => {
    expect(notionCallbackResponseSchema.safeParse({outcome: 'connected'}).success).toBe(false);
    expect(notionCallbackResponseSchema.safeParse({outcome: 'unknown'}).success).toBe(false);
  });
});

describe('Notion tools and E2E seed DTO', () => {
  it('exposes exactly the eight tool ids', () => {
    expect(notionAgentToolIds).toEqual([
      'search',
      'get_page',
      'get_page_content',
      'query_data_source',
      'get_comments',
      'create_page',
      'update_page',
      'add_comment',
    ]);
    expect(notionAgentToolIdSchema.parse('query_data_source')).toBe('query_data_source');
    expect(notionAgentToolIdSchema.safeParse('delete_page').success).toBe(false);
  });

  it('validates the connection seed fields and rejects missing provider credentials', () => {
    const notionWorkspaceId = '00000000-0000-4000-8000-000000000001';
    const botId = '00000000-0000-4000-8000-000000000002';
    const authorizedByUserId = '00000000-0000-4000-8000-000000000003';
    const result = createE2eNotionConnectionBodySchema.safeParse({
      workspace_id: connection.workspace_id,
      notion_workspace_id: notionWorkspaceId,
      workspace_name: 'Acme',
      bot_id: botId,
      authorized_by_user_id: authorizedByUserId,
      access_token: 'token-1',
      display_name: 'Acme Notion',
    });

    expect(result.success).toBe(true);
    expect(
      createE2eNotionConnectionBodySchema.safeParse({
        workspace_id: connection.workspace_id,
        notion_workspace_id: notionWorkspaceId,
      }).success,
    ).toBe(false);
    expect(
      createE2eNotionConnectionBodySchema.safeParse({
        workspace_id: connection.workspace_id,
        notion_workspace_id: 'notion-workspace-1',
        workspace_name: 'Acme',
        bot_id: 'bot-1',
        authorized_by_user_id: 'user-1',
        access_token: 'token-1',
        display_name: 'Acme Notion',
      }).success,
    ).toBe(false);
  });
});

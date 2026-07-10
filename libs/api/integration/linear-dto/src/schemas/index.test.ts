import {
  LINEAR_PROVIDER,
  linearAgentSessionWebhookBaseEnvelopeSchema,
  linearAgentSessionWebhookEnvelopeSchema,
  linearWebhookBaseEnvelopeSchema,
  linearWebhookEnvelopeSchema,
  linearWebhookEventNames,
} from './index.js';

describe('LINEAR_PROVIDER', () => {
  it('names the Linear provider id', () => {
    expect(LINEAR_PROVIDER).toBe('linear');
  });
});

describe('linear webhook schemas', () => {
  it('accepts supported data webhook envelopes', () => {
    const result = linearWebhookEnvelopeSchema.parse({
      action: 'create',
      type: 'Issue',
      organizationId: 'org-1',
      webhookTimestamp: 1_786_257_600_000,
      data: {id: 'issue-1'},
    });

    expect(result.type).toBe('Issue');
    expect(result.action).toBe('create');
  });

  it('rejects unsupported resources and actions from the supported event schema', () => {
    expect(
      linearWebhookEnvelopeSchema.safeParse({
        action: 'create',
        type: 'Reaction',
        organizationId: 'org-1',
        webhookTimestamp: 1_786_257_600_000,
        data: {id: 'reaction-1'},
      }).success,
    ).toBe(false);
    expect(
      linearWebhookEnvelopeSchema.safeParse({
        action: 'archive',
        type: 'Issue',
        organizationId: 'org-1',
        webhookTimestamp: 1_786_257_600_000,
        data: {id: 'issue-1'},
      }).success,
    ).toBe(false);
  });

  it.each([
    null,
    'issue-1',
    1,
  ])('rejects non-object data payloads from supported events', (data) => {
    const result = linearWebhookEnvelopeSchema.safeParse({
      action: 'create',
      type: 'Issue',
      organizationId: 'org-1',
      webhookTimestamp: 1_786_257_600_000,
      data,
    });

    expect(result.success).toBe(false);
  });

  it('accepts unsupported but routable base envelopes for record-and-drop handling', () => {
    const result = linearWebhookBaseEnvelopeSchema.parse({
      action: 'create',
      type: 'Reaction',
      organizationId: 'org-1',
      webhookTimestamp: 1_786_257_600_000,
      data: {id: 'reaction-1'},
    });

    expect(result.type).toBe('Reaction');
  });

  it.each([
    'created',
    'prompted',
  ] as const)('accepts the supported AgentSessionEvent %s action', (action) => {
    const result = linearAgentSessionWebhookEnvelopeSchema.parse({
      action,
      type: 'AgentSessionEvent',
      organizationId: 'org-1',
      appUserId: 'app-user-1',
      webhookTimestamp: 1_786_257_600_000,
      agentSession: {id: 'session-1'},
    });

    expect(result.action).toBe(action);
  });

  it.each([
    ['organizationId', undefined],
    ['organizationId', ''],
    ['appUserId', undefined],
    ['appUserId', ''],
    ['webhookTimestamp', undefined],
    ['webhookTimestamp', 1.5],
    ['agentSession', undefined],
    ['agentSession', 'session-1'],
  ])('rejects AgentSessionEvent payloads missing or invalid %s', (field, value) => {
    const payload = {
      action: 'created',
      type: 'AgentSessionEvent',
      organizationId: 'org-1',
      appUserId: 'app-user-1',
      webhookTimestamp: 1_786_257_600_000,
      agentSession: {id: 'session-1'},
      [field]: value,
    };

    expect(linearAgentSessionWebhookEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts an unknown AgentSessionEvent action in the base schema but not the supported schema', () => {
    const payload = {
      action: 'resolved',
      type: 'AgentSessionEvent',
      organizationId: 'org-1',
      appUserId: 'app-user-1',
      webhookTimestamp: 1_786_257_600_000,
      agentSession: {id: 'session-1'},
    };

    expect(linearAgentSessionWebhookBaseEnvelopeSchema.safeParse(payload).success).toBe(true);
    expect(linearAgentSessionWebhookEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it('exports Linear-facing event names without remapping resource casing', () => {
    expect(linearWebhookEventNames).toContain('Issue.create');
    expect(linearWebhookEventNames).toContain('IssueLabel.update');
    expect(linearWebhookEventNames).toContain('Cycle.remove');
    expect(linearWebhookEventNames).toContain('agentSession.created');
    expect(linearWebhookEventNames).toContain('agentSession.prompted');
  });
});

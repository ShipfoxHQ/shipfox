import {
  LINEAR_PROVIDER,
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

  it('exports Linear-facing event names without remapping resource casing', () => {
    expect(linearWebhookEventNames).toContain('Issue.create');
    expect(linearWebhookEventNames).toContain('IssueLabel.update');
    expect(linearWebhookEventNames).toContain('Cycle.remove');
  });
});

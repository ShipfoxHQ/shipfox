import {
  createWebhookConnectionBodySchema,
  WEBHOOK_RESERVED_SLUGS,
  webhookConnectionDtoSchema,
  webhookSlugSchema,
} from './index.js';

describe('webhookSlugSchema', () => {
  it.each(WEBHOOK_RESERVED_SLUGS)('rejects reserved slug %s', (slug) => {
    const result = webhookSlugSchema.safeParse(slug);

    expect(result.success).toBe(false);
  });

  it.each(['stripe', 'stripe-prod', 'stripe_prod'])('accepts normal lowercase slug %s', (slug) => {
    const result = webhookSlugSchema.safeParse(slug);

    expect(result.success).toBe(true);
  });
});

describe('createWebhookConnectionBodySchema', () => {
  it.each(WEBHOOK_RESERVED_SLUGS)('rejects reserved slug %s', (slug) => {
    const result = createWebhookConnectionBodySchema.safeParse({
      workspace_id: crypto.randomUUID(),
      name: 'Reserved',
      slug,
    });

    expect(result.success).toBe(false);
  });
});

describe('webhookConnectionDtoSchema', () => {
  it.each(WEBHOOK_RESERVED_SLUGS)('accepts legacy reserved response slug %s', (slug) => {
    const now = new Date().toISOString();

    const result = webhookConnectionDtoSchema.safeParse({
      id: crypto.randomUUID(),
      workspace_id: crypto.randomUUID(),
      name: 'Legacy',
      slug,
      lifecycle_status: 'active',
      inbound_url: 'https://example.com/webhook/legacy',
      created_at: now,
      updated_at: now,
    });

    expect(result.success).toBe(true);
  });
});

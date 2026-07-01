import {WEBHOOK_RESERVED_SLUGS, webhookSlugSchema} from './index.js';

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

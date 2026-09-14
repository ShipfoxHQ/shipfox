import {clickupWebhookUrl} from './webhook-url.js';

describe('clickupWebhookUrl', () => {
  it('builds a registrable connection webhook URL', () => {
    const connectionId = crypto.randomUUID();

    const result = clickupWebhookUrl(connectionId);

    expect(result).toBe(
      `https://shipfox.example.com/webhooks/integrations/clickup/${connectionId}`,
    );
  });
});

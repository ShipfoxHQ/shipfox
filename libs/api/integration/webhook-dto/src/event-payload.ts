import {z} from 'zod';
import {WEBHOOK_FORWARDED_HEADERS} from './constants.js';

// The normalized `event` value a workflow receives for an accepted request.
export const webhookReceivedEventPayloadSchema = z.object({
  method: z.string().describe('HTTP method used for the delivery.'),
  headers: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .describe(
      `Request headers. Shipfox keeps ${WEBHOOK_FORWARDED_HEADERS.join(', ')} and replaces every other value with [redacted].`,
    ),
  query: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .describe('Parsed query parameters. A repeated parameter becomes an array.'),
  body: z.unknown().describe('Parsed JSON, form data, or plain-text body.'),
});
export type WebhookReceivedEventPayloadDto = z.infer<typeof webhookReceivedEventPayloadSchema>;

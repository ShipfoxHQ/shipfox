import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyReply} from 'fastify';
import type {z} from 'zod';
import type {SentryWebhookContext} from './webhook-context.js';

export const SENTRY_PROVIDER = 'sentry';

/**
 * Parses and validates a delivery body, recording-and-dropping it (HTTP 204) when
 * the JSON is malformed or fails the schema (an unknown action falls here too).
 * Returns the validated payload, or null when the delivery was dropped.
 */
export async function parseAndValidateOrDrop<TSchema extends z.ZodType>(args: {
  schema: TSchema;
  rawBody: string;
  deliveryId: string;
  context: SentryWebhookContext;
  reply: FastifyReply;
  normalize?: (parsedJson: unknown) => unknown;
}): Promise<z.infer<TSchema> | null> {
  const {schema, rawBody, deliveryId, context, reply, normalize} = args;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (error) {
    logger().warn({deliveryId, err: error}, 'sentry webhook: payload JSON parse failed, dropping');
    await recordAndDrop({context, reply, deliveryId});
    return null;
  }

  const validated = schema.safeParse(normalize ? normalize(parsedJson) : parsedJson);
  if (!validated.success) {
    logger().warn(
      {deliveryId, issues: validated.error.issues},
      'sentry webhook: payload failed validation (or unknown action), dropping',
    );
    await recordAndDrop({context, reply, deliveryId});
    return null;
  }

  return validated.data;
}

/**
 * Records the delivery for dedup and replies 204 without acting on it. A sustained
 * non-2xx can degrade or disable the webhook on Sentry's side (a deliberate
 * deviation from GitHub's 400), so deliveries we cannot use are acknowledged.
 */
export async function recordAndDrop(args: {
  context: SentryWebhookContext;
  reply: FastifyReply;
  deliveryId: string;
}): Promise<null> {
  const {context, reply, deliveryId} = args;
  await context.coreDb().transaction(async (tx) => {
    await context.recordDeliveryOnly({tx, provider: SENTRY_PROVIDER, deliveryId});
  });
  reply.code(204);
  return null;
}

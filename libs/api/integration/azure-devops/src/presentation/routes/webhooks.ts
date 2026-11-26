import {randomUUID} from 'node:crypto';
import type {StoredWebhookRequest, WebhookProcessingResult} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest, WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {
  ClientError,
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {AzureDevOpsWebhookProcessor} from '#core/webhook-processor.js';
import {AZURE_DEVOPS_WEBHOOK_ROUTE_PREFIX} from '#core/webhook-url.js';

const paramsSchema = z.object({connectionId: z.string().uuid()});

export interface CreateAzureDevOpsWebhookRoutesOptions {
  processor: AzureDevOpsWebhookProcessor;
}

export function createAzureDevOpsWebhookRoutes(
  options: CreateAzureDevOpsWebhookRoutesOptions,
): RouteGroup {
  const serviceHookRoute = defineRoute({
    method: 'POST',
    path: '/:connectionId',
    auth: [],
    description: 'Azure DevOps Service Hook receiver for one connection.',
    schema: {params: paramsSchema},
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      if (typeof request.headers.authorization !== 'string') {
        reply.code(401);
        return {error: 'missing basic authorization'};
      }
      if (!(request.body instanceof Uint8Array)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const result = await options.processor.process(
        createAzureDevOpsStoredWebhookRequest({
          body: request.body,
          connectionId: request.params.connectionId,
          headers: request.headers,
          rawQueryString: request.raw.url?.split('?')[1] ?? '',
        }),
      );
      return sendAzureDevOpsWebhookResponse(reply, result);
    },
  });

  return {
    prefix: AZURE_DEVOPS_WEBHOOK_ROUTE_PREFIX,
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [serviceHookRoute],
  };
}

function createAzureDevOpsStoredWebhookRequest(input: {
  body: Uint8Array;
  connectionId: string;
  headers: Record<string, string | string[] | undefined>;
  rawQueryString: string;
}): StoredWebhookRequest {
  if (input.body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
  }
  try {
    return createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'azure-devops',
      receivedAt: new Date().toISOString(),
      rawQueryString: input.rawQueryString,
      headers: azureDevOpsWebhookHeaders(input.headers),
      body: input.body,
      connectionId: input.connectionId,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function azureDevOpsWebhookHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    ['authorization', 'content-type'].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendAzureDevOpsWebhookResponse(
  reply: {code(statusCode: number): void},
  result: WebhookProcessingResult,
) {
  if (result.outcome !== 'discarded') {
    reply.code(204);
    return null;
  }
  if (result.reason === 'invalid_signature' || result.reason === 'missing_required_input') {
    reply.code(401);
    return {error: 'invalid authorization'};
  }
  reply.code(400);
  return {error: 'malformed Service Hook payload'};
}

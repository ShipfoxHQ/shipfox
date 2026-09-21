import {createHmac} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

export const NOTION_TEST_VERIFICATION_TOKEN =
  process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN ?? 'e2e-notion-verification-token';

export interface NotionAccessibleByActor {
  id: string;
  type: 'person' | 'bot';
}

export function signNotionHeaders(
  rawBody: string,
  verificationToken = NOTION_TEST_VERIFICATION_TOKEN,
): Record<string, string> {
  return {
    'x-notion-signature': `sha256=${createHmac('sha256', verificationToken).update(rawBody).digest('hex')}`,
  };
}

export function buildPagePropertiesUpdatedEnvelope(params: {
  deliveryId: string;
  workspaceId: string;
  botId: string;
  pageId: string;
  actorId: string;
  actorType?: 'person' | 'bot' | 'agent';
  accessibleBy?: NotionAccessibleByActor[] | undefined;
}) {
  return {
    id: params.deliveryId,
    timestamp: new Date().toISOString(),
    workspace_id: params.workspaceId,
    subscription_id: '00000000-0000-4000-8000-000000000001',
    integration_id: '00000000-0000-4000-8000-000000000002',
    type: 'page.properties_updated' as const,
    authors: [{id: params.actorId, type: params.actorType ?? 'person'}],
    accessible_by: params.accessibleBy ?? [{id: params.botId, type: 'bot'}],
    attempt_number: 1,
    entity: {id: params.pageId, type: 'page' as const},
    data: {
      parent: {id: '00000000-0000-4000-8000-000000000003', type: 'data_source'},
      updated_properties: ['status'],
    },
  };
}

export async function postNotionDelivery(params: {
  deliveryId: string;
  workspaceId: string;
  botId: string;
  pageId: string;
  actorId: string;
  actorType?: 'person' | 'bot' | 'agent';
  accessibleBy?: NotionAccessibleByActor[] | undefined;
  verificationToken?: string | undefined;
}): Promise<string> {
  const envelope = buildPagePropertiesUpdatedEnvelope(params);
  const rawBody = JSON.stringify(envelope);
  const response = await fetch(new URL('/webhooks/integrations/notion', config.API_URL), {
    method: 'POST',
    body: rawBody,
    headers: {
      ...signNotionHeaders(rawBody, params.verificationToken),
      'content-type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Signed Notion event delivery failed with ${response.status}.`);
  }
  return params.deliveryId;
}

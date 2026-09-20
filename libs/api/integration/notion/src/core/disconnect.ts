import {logger} from '@shipfox/node-opentelemetry';
import type {NotionApiClient} from '#api/client.js';
import type {NotionTokenStore} from './tokens.js';

export async function prepareNotionTokenRevocation(params: {
  connectionId: string;
  tokenStore: Pick<NotionTokenStore, 'getAccessToken'>;
  notion: Pick<NotionApiClient, 'revokeToken'>;
}): Promise<(() => Promise<void>) | undefined> {
  let accessToken: string;
  try {
    accessToken = await params.tokenStore.getAccessToken({connectionId: params.connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Notion token revocation could not read the access token',
    );
    return undefined;
  }

  return async () => {
    try {
      await params.notion.revokeToken({token: accessToken});
    } catch (error) {
      logger().warn(
        {err: error, connectionId: params.connectionId},
        'Notion token revocation failed during connection deletion',
      );
    }
  };
}

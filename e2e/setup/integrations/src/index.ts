import type {
  CreateE2eLinearConnectionBodyDto,
  CreateE2eLinearConnectionResponseDto,
} from '@shipfox/api-integration-linear-dto';
import {requestJson} from '@shipfox/e2e-core';

export type {
  CreateE2eLinearConnectionBodyDto,
  CreateE2eLinearConnectionResponseDto,
} from '@shipfox/api-integration-linear-dto';

export interface CreateLinearConnectionParams {
  workspaceId: string;
  organizationId: string;
  organizationUrlKey: string;
  appUserId: string;
  displayName: string;
  accessToken: string;
  scopes?: string[] | undefined;
}

function linearConnectionBody(
  params: CreateLinearConnectionParams,
): CreateE2eLinearConnectionBodyDto {
  return {
    workspace_id: params.workspaceId,
    organization_id: params.organizationId,
    organization_url_key: params.organizationUrlKey,
    app_user_id: params.appUserId,
    display_name: params.displayName,
    access_token: params.accessToken,
    scopes: params.scopes ?? ['read', 'write'],
  };
}

export async function createLinearConnection(
  params: CreateLinearConnectionParams,
): Promise<CreateE2eLinearConnectionResponseDto> {
  return await requestJson<CreateE2eLinearConnectionResponseDto>(
    'post',
    '/__e2e/integrations/linear-connections',
    {json: linearConnectionBody(params)},
  );
}

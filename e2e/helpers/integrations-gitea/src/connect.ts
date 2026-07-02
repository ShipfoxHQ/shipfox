import type {
  CreateGiteaConnectionBodyDto,
  CreateGiteaConnectionResponseDto,
} from '@shipfox/api-integration-gitea-dto';
import {requestJson} from '@shipfox/e2e-core';

export interface ConnectGiteaOrgParams {
  workspaceId: string;
  org: string;
  sessionToken: string;
}

// Links the org to the workspace through the product route, authenticated with the
// suite user's session token instead of the E2E admin key the core client defaults to.
export async function connectGiteaOrg(
  params: ConnectGiteaOrgParams,
): Promise<CreateGiteaConnectionResponseDto> {
  const body: CreateGiteaConnectionBodyDto = {
    workspace_id: params.workspaceId,
    org: params.org,
  };

  return await requestJson<CreateGiteaConnectionResponseDto>(
    'post',
    '/integrations/gitea/connections',
    {json: body, headers: {authorization: `Bearer ${params.sessionToken}`}},
  );
}

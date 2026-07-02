import type {CreateProvisionerTokenResponseDto} from '@shipfox/api-runners-dto';
import {requestJson} from '@shipfox/e2e-core';

export interface MintProvisionerTokenParams {
  workspaceId: string;
  /**
   * User session bearer (the `token` from an E2E session). The provisioner-token
   * route is user-authed and workspace-scoped, so the shared E2E admin key that
   * `@shipfox/e2e-core` sends by default does not satisfy it.
   */
  userToken: string;
  name?: string;
  ttlSeconds?: number;
}

/**
 * Mints a workspace provisioner token. The `raw_token` on the response is returned
 * once by the API and is the value to hand to `startProvisioner`.
 */
export async function mintProvisionerToken(
  params: MintProvisionerTokenParams,
): Promise<CreateProvisionerTokenResponseDto> {
  return await requestJson<CreateProvisionerTokenResponseDto>(
    'post',
    `/workspaces/${params.workspaceId}/provisioners/tokens`,
    {
      headers: {authorization: `Bearer ${params.userToken}`},
      json: {name: params.name, ttl_seconds: params.ttlSeconds},
    },
  );
}

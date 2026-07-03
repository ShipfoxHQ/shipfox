import type {CreateManualRegistrationTokenResponseDto} from '@shipfox/api-runners-dto';
import {requestJson} from '@shipfox/e2e-core';

export interface MintManualRegistrationTokenParams {
  workspaceId: string;
  /** User session bearer allowed to manage runner registration tokens. */
  userToken: string;
  /** Human-readable token name shown in runner settings. */
  name?: string | undefined;
  /** Token lifetime in seconds. Omitted uses the API default. */
  ttlSeconds?: number | undefined;
}

export async function mintManualRegistrationToken(
  params: MintManualRegistrationTokenParams,
): Promise<CreateManualRegistrationTokenResponseDto> {
  return await requestJson<CreateManualRegistrationTokenResponseDto>(
    'post',
    `/workspaces/${params.workspaceId}/runners/manual-registration-tokens`,
    {
      headers: {authorization: `Bearer ${params.userToken}`},
      json: {
        ...(params.name !== undefined ? {name: params.name} : {}),
        ...(params.ttlSeconds !== undefined ? {ttl_seconds: params.ttlSeconds} : {}),
      },
    },
  );
}

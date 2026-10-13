import {randomUUID} from 'node:crypto';
import type {
  CreateAdministratorProvisionerTokenResponseDto,
  CreateProvisionerTokenResponseDto,
} from '@shipfox/api-runners-dto';
import {createApiClient} from '@shipfox/e2e-core';

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
  const client = createApiClient({token: params.userToken});

  return await client.requestJson<CreateProvisionerTokenResponseDto>(
    'post',
    `/workspaces/${params.workspaceId}/provisioners/tokens`,
    {json: {name: params.name, ttl_seconds: params.ttlSeconds}},
  );
}

export interface MintInstallationProvisionerTokenParams {
  /** Administrator bearer allowed to create installation provisioner tokens. */
  adminToken: string;
  /** Human-readable token name shown in administrator settings. */
  name?: string | undefined;
  /** Why the administrator token is being created. */
  reason?: string | undefined;
  /** Token lifetime in seconds. Omitted uses the API default. */
  ttlSeconds?: number | undefined;
  /** Stable key for retrying the same create command. Defaults to a new UUID. */
  idempotencyKey?: string | undefined;
}

/**
 * Mints an installation-wide provisioner token through the administrator route.
 * The API requires an idempotency key because this command creates a durable token.
 */
export async function mintInstallationProvisionerToken(
  params: MintInstallationProvisionerTokenParams,
): Promise<CreateAdministratorProvisionerTokenResponseDto> {
  const client = createApiClient({token: params.adminToken});
  const body = {
    reason: params.reason ?? 'E2E installation provisioner',
    ...(params.name !== undefined ? {name: params.name} : {}),
    ...(params.ttlSeconds !== undefined ? {ttl_seconds: params.ttlSeconds} : {}),
  };

  return await client.requestJson<CreateAdministratorProvisionerTokenResponseDto>(
    'post',
    '/admin/runners/provisioner-tokens',
    {
      headers: {'Idempotency-Key': params.idempotencyKey ?? randomUUID()},
      json: body,
    },
  );
}

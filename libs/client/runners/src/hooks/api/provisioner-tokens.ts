import type {
  CreateProvisionerTokenBodyDto,
  CreateProvisionerTokenResponseDto,
  ListActiveProvisionersResponseDto,
  ListProvisionerTokensResponseDto,
  RevokeProvisionerTokenResponseDto,
} from '@shipfox/api-runners-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQuery} from '@tanstack/react-query';

const PROVISIONER_TOKEN_REFETCH_INTERVAL_MS = 30_000;

export const provisionerTokenQueryKeys = {
  all: ['provisioner-tokens'] as const,
  list: (workspaceId: string) => [...provisionerTokenQueryKeys.all, 'tokens', workspaceId] as const,
  active: (workspaceId: string) =>
    [...provisionerTokenQueryKeys.all, 'provisioners', workspaceId] as const,
};

export async function listProvisionerTokens({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<ListProvisionerTokensResponseDto>(
    `/workspaces/${workspaceId}/provisioners/tokens`,
    {signal},
  );
}

export async function createProvisionerToken({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: CreateProvisionerTokenBodyDto;
}) {
  return await apiRequest<CreateProvisionerTokenResponseDto>(
    `/workspaces/${workspaceId}/provisioners/tokens`,
    {method: 'POST', body},
  );
}

export async function revokeProvisionerToken({
  workspaceId,
  tokenId,
}: {
  workspaceId: string;
  tokenId: string;
}) {
  return await apiRequest<RevokeProvisionerTokenResponseDto>(
    `/workspaces/${workspaceId}/provisioners/tokens/${tokenId}/revoke`,
    {method: 'POST'},
  );
}

export async function listActiveProvisioners({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<ListActiveProvisionersResponseDto>(
    `/workspaces/${workspaceId}/provisioners/active`,
    {signal},
  );
}

export function useProvisionerTokensQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? provisionerTokenQueryKeys.list(workspaceId)
      : [...provisionerTokenQueryKeys.all, 'tokens'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listProvisionerTokens({workspaceId: workspaceId ?? '', signal}),
    refetchInterval: PROVISIONER_TOKEN_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useCreateProvisionerTokenMutation() {
  return useMutation({mutationFn: createProvisionerToken});
}

export function useRevokeProvisionerTokenMutation() {
  return useMutation({mutationFn: revokeProvisionerToken});
}

export function useActiveProvisionersQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? provisionerTokenQueryKeys.active(workspaceId)
      : [...provisionerTokenQueryKeys.all, 'provisioners'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listActiveProvisioners({workspaceId: workspaceId ?? '', signal}),
    refetchInterval: PROVISIONER_TOKEN_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

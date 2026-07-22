import {
  createProvisionerTokenResponseSchema,
  listActiveProvisionersResponseSchema,
  listProvisionerTokensResponseSchema,
  revokeProvisionerTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {
  ActiveProvisioner,
  CreatedProvisionerToken,
  CreateTokenCommand,
  ProvisionerToken,
} from '#core/token.js';
import {
  toActiveProvisioner,
  toCreatedProvisionerToken,
  toCreateTokenBody,
  toProvisionerToken,
} from './token-mapper.js';

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
}): Promise<ProvisionerToken[]> {
  const response = await checkedApiRequest(
    listProvisionerTokensResponseSchema,
    `/workspaces/${workspaceId}/provisioners/tokens`,
    {signal},
  );
  return response.tokens.map(toProvisionerToken);
}

export async function createProvisionerToken({
  workspaceId,
  command,
}: {
  workspaceId: string;
  command: CreateTokenCommand;
}): Promise<CreatedProvisionerToken> {
  const response = await checkedApiRequest(
    createProvisionerTokenResponseSchema,
    `/workspaces/${workspaceId}/provisioners/tokens`,
    {method: 'POST', body: toCreateTokenBody(command)},
  );
  return toCreatedProvisionerToken(response);
}

export async function revokeProvisionerToken({
  workspaceId,
  tokenId,
}: {
  workspaceId: string;
  tokenId: string;
}): Promise<ProvisionerToken> {
  const response = await checkedApiRequest(
    revokeProvisionerTokenResponseSchema,
    `/workspaces/${workspaceId}/provisioners/tokens/${tokenId}/revoke`,
    {method: 'POST'},
  );
  return toProvisionerToken(response);
}

export async function listActiveProvisioners({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<ActiveProvisioner[]> {
  const response = await checkedApiRequest(
    listActiveProvisionersResponseSchema,
    `/workspaces/${workspaceId}/provisioners/active`,
    {signal},
  );
  return response.provisioners.map(toActiveProvisioner);
}

export function provisionerTokensQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: provisionerTokenQueryKeys.list(workspaceId),
    queryFn: ({signal}) => listProvisionerTokens({workspaceId, signal}),
    refetchInterval: PROVISIONER_TOKEN_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function activeProvisionersQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: provisionerTokenQueryKeys.active(workspaceId),
    queryFn: ({signal}) => listActiveProvisioners({workspaceId, signal}),
    refetchInterval: PROVISIONER_TOKEN_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useProvisionerTokensQuery(workspaceId: string | undefined) {
  return useQuery({
    ...provisionerTokensQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useActiveProvisionersQuery(workspaceId: string | undefined) {
  return useQuery({
    ...activeProvisionersQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateProvisionerTokenMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateTokenCommand) => createProvisionerToken({workspaceId, command}),
    onSuccess: async () => {
      await queryClient.invalidateQueries(provisionerTokensQueryOptions(workspaceId));
    },
  });
}

export function useRevokeProvisionerTokenMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => revokeProvisionerToken({workspaceId, tokenId}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(provisionerTokensQueryOptions(workspaceId)),
        queryClient.invalidateQueries(activeProvisionersQueryOptions(workspaceId)),
      ]);
    },
  });
}

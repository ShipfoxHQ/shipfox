import type {
  CreateRunnerTokenBodyDto,
  CreateRunnerTokenResponseDto,
  ListRunnerTokensResponseDto,
  RevokeRunnerTokenResponseDto,
} from '@shipfox/api-runners-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQuery} from '@tanstack/react-query';

export const runnerTokenQueryKeys = {
  all: ['runner-tokens'] as const,
  list: (workspaceId: string) => [...runnerTokenQueryKeys.all, 'list', workspaceId] as const,
};

export async function listRunnerTokens({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<ListRunnerTokensResponseDto>(
    `/workspaces/${workspaceId}/runners/tokens`,
    {signal},
  );
}

export async function createRunnerToken({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: CreateRunnerTokenBodyDto;
}) {
  return await apiRequest<CreateRunnerTokenResponseDto>(
    `/workspaces/${workspaceId}/runners/tokens`,
    {method: 'POST', body},
  );
}

export async function revokeRunnerToken({
  workspaceId,
  tokenId,
}: {
  workspaceId: string;
  tokenId: string;
}) {
  return await apiRequest<RevokeRunnerTokenResponseDto>(
    `/workspaces/${workspaceId}/runners/tokens/${tokenId}/revoke`,
    {method: 'POST'},
  );
}

export function useRunnerTokensQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? runnerTokenQueryKeys.list(workspaceId)
      : [...runnerTokenQueryKeys.all, 'list'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listRunnerTokens({workspaceId: workspaceId ?? '', signal}),
  });
}

export function useCreateRunnerTokenMutation() {
  return useMutation({mutationFn: createRunnerToken});
}

export function useRevokeRunnerTokenMutation() {
  return useMutation({mutationFn: revokeRunnerToken});
}

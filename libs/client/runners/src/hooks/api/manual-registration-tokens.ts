import type {
  CreateManualRegistrationTokenBodyDto,
  CreateManualRegistrationTokenResponseDto,
  ListManualRegistrationTokensResponseDto,
  RevokeManualRegistrationTokenResponseDto,
} from '@shipfox/api-runners-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQuery} from '@tanstack/react-query';

export const manualRegistrationTokenQueryKeys = {
  all: ['manual-registration-tokens'] as const,
  list: (workspaceId: string) =>
    [...manualRegistrationTokenQueryKeys.all, 'list', workspaceId] as const,
};

export async function listManualRegistrationTokens({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<ListManualRegistrationTokensResponseDto>(
    `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
    {signal},
  );
}

export async function createManualRegistrationToken({
  workspaceId,
  body,
}: {
  workspaceId: string;
  body: CreateManualRegistrationTokenBodyDto;
}) {
  return await apiRequest<CreateManualRegistrationTokenResponseDto>(
    `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
    {method: 'POST', body},
  );
}

export async function revokeManualRegistrationToken({
  workspaceId,
  tokenId,
}: {
  workspaceId: string;
  tokenId: string;
}) {
  return await apiRequest<RevokeManualRegistrationTokenResponseDto>(
    `/workspaces/${workspaceId}/runners/manual-registration-tokens/${tokenId}/revoke`,
    {method: 'POST'},
  );
}

export function useManualRegistrationTokensQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? manualRegistrationTokenQueryKeys.list(workspaceId)
      : [...manualRegistrationTokenQueryKeys.all, 'list'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listManualRegistrationTokens({workspaceId: workspaceId ?? '', signal}),
  });
}

export function useCreateManualRegistrationTokenMutation() {
  return useMutation({mutationFn: createManualRegistrationToken});
}

export function useRevokeManualRegistrationTokenMutation() {
  return useMutation({mutationFn: revokeManualRegistrationToken});
}

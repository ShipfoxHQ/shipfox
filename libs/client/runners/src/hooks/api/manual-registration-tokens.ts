import {
  createManualRegistrationTokenResponseSchema,
  listManualRegistrationTokensResponseSchema,
  revokeManualRegistrationTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type FetchQueryOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreatedManualRegistrationToken,
  CreateTokenCommand,
  ManualRegistrationToken,
} from '#core/token.js';
import {
  toCreatedManualRegistrationToken,
  toCreateTokenBody,
  toManualRegistrationToken,
} from './token-mapper.js';

export const manualRegistrationTokenQueryKeys = {
  all: ['manual-registration-tokens'] as const,
  list: (workspaceId: string) =>
    [...manualRegistrationTokenQueryKeys.all, 'list', workspaceId] as const,
};

type ManualRegistrationTokensQueryOptions = FetchQueryOptions<
  ManualRegistrationToken[],
  Error,
  ManualRegistrationToken[],
  ReturnType<typeof manualRegistrationTokenQueryKeys.list>
>;

export async function listManualRegistrationTokens({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<ManualRegistrationToken[]> {
  const response = await checkedApiRequest(
    listManualRegistrationTokensResponseSchema,
    `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
    {signal},
  );
  return response.manual_registration_tokens.map(toManualRegistrationToken);
}

export async function createManualRegistrationToken({
  workspaceId,
  command,
}: {
  workspaceId: string;
  command: CreateTokenCommand;
}): Promise<CreatedManualRegistrationToken> {
  const response = await checkedApiRequest(
    createManualRegistrationTokenResponseSchema,
    `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
    {method: 'POST', body: toCreateTokenBody(command)},
  );
  return toCreatedManualRegistrationToken(response);
}

export async function revokeManualRegistrationToken({
  workspaceId,
  tokenId,
}: {
  workspaceId: string;
  tokenId: string;
}): Promise<ManualRegistrationToken> {
  const response = await checkedApiRequest(
    revokeManualRegistrationTokenResponseSchema,
    `/workspaces/${workspaceId}/runners/manual-registration-tokens/${tokenId}/revoke`,
    {method: 'POST'},
  );
  return toManualRegistrationToken(response);
}

export function manualRegistrationTokensQueryOptions(
  workspaceId: string,
): ManualRegistrationTokensQueryOptions {
  return queryOptions({
    queryKey: manualRegistrationTokenQueryKeys.list(workspaceId),
    queryFn: ({signal}) => listManualRegistrationTokens({workspaceId, signal}),
  });
}

export function useManualRegistrationTokensQuery(workspaceId: string | undefined) {
  return useQuery({
    ...manualRegistrationTokensQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateManualRegistrationTokenMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateTokenCommand) =>
      createManualRegistrationToken({workspaceId, command}),
    onSuccess: async () => {
      await queryClient.invalidateQueries(manualRegistrationTokensQueryOptions(workspaceId));
    },
  });
}

export function useRevokeManualRegistrationTokenMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => revokeManualRegistrationToken({workspaceId, tokenId}),
    onSuccess: async () => {
      await queryClient.invalidateQueries(manualRegistrationTokensQueryOptions(workspaceId));
    },
  });
}

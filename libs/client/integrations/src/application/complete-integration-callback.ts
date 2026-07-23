import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {useCallback} from 'react';
import type {IntegrationConnection} from '#core/models.js';
import {integrationsQueryKeys} from '#hooks/api/integrations.js';

export interface CompleteIntegrationCallbackOptions<TInput> {
  input: TInput;
  refreshAuth: () => Promise<{accessToken: string}>;
  complete: (input: TInput, accessToken: string) => Promise<IntegrationConnection>;
  queryClient: QueryClient;
}

export async function completeIntegrationCallback<TInput>({
  input,
  refreshAuth,
  complete,
  queryClient,
}: CompleteIntegrationCallbackOptions<TInput>): Promise<IntegrationConnection> {
  const session = await refreshAuth();
  const connection = await complete(input, session.accessToken);
  try {
    await queryClient.invalidateQueries({
      queryKey: integrationsQueryKeys.connectionsByWorkspace(connection.workspaceId),
    });
  } catch {
    // Cache refresh is best effort: the successful callback is already committed server-side.
  }
  return connection;
}

export function useCompleteIntegrationCallback() {
  const queryClient = useQueryClient();
  return useCallback(
    async <TInput>(
      options: Omit<CompleteIntegrationCallbackOptions<TInput>, 'queryClient'>,
    ): Promise<IntegrationConnection> => completeIntegrationCallback({...options, queryClient}),
    [queryClient],
  );
}

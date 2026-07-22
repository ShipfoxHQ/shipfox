import type {QueryClient} from '@tanstack/react-query';
import type {IntegrationConnection} from '#core/models.js';
import {integrationsQueryKeys} from '#hooks/api/integrations.js';

export async function completeIntegrationCallback<TInput>({
  input,
  refreshAuth,
  complete,
  queryClient,
}: {
  input: TInput;
  refreshAuth: () => Promise<{accessToken: string}>;
  complete: (input: TInput, accessToken: string) => Promise<IntegrationConnection>;
  queryClient: QueryClient;
}): Promise<IntegrationConnection> {
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

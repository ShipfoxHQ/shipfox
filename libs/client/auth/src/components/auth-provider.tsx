import {AuthRuntime} from '@shipfox/client-shell/runtime';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Provider as JotaiProvider} from 'jotai';
import {type PropsWithChildren, useState} from 'react';

export interface AuthProviderProps extends PropsWithChildren {
  queryClient?: QueryClient;
}

/**
 * Backwards-compatible provider for applications that have not adopted
 * `composeClientApp` yet. The shell owns the runtime behavior in both paths.
 */
export function AuthProvider({children, queryClient}: AuthProviderProps) {
  const [fallbackQueryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient ?? fallbackQueryClient}>
      <JotaiProvider>
        <AuthRuntime>{children}</AuthRuntime>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

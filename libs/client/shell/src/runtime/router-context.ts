import type {AuthStateValue} from '@shipfox/client-auth';
import type {QueryClient} from '@tanstack/react-query';

export interface RouterContext {
  auth: AuthStateValue | undefined;
  queryClient: QueryClient | undefined;
}

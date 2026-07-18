import type {QueryClient} from '@tanstack/react-query';
import type {AuthStateValue} from './auth.js';

export interface RouterContext {
  auth: AuthStateValue | undefined;
  queryClient: QueryClient | undefined;
}

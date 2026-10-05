import type {QueryClient} from '@tanstack/react-query';
import type {AuthStateValue} from './auth.js';
import type {WorkspaceSetupGate} from './workspace-setup.js';

export interface ProjectSlugResolverOptions {
  queryClient: QueryClient;
  workspaceId: string;
  projectSlug: string;
}

export type ProjectSlugResolver = (
  options: ProjectSlugResolverOptions,
) => Promise<string | undefined>;

export interface RouterContext {
  auth: AuthStateValue | undefined;
  queryClient: QueryClient | undefined;
  workspaceSetup?: WorkspaceSetupGate;
  /** Re-runs route guards; the workspace setup gate receives it as `revalidate`. */
  revalidateRoutes?: () => void;
  projectSlugResolver?: ProjectSlugResolver;
  /** Whether the composing application supplied the unresolved-workspace slot. */
  unresolvedWorkspaceAvailable?: boolean;
}

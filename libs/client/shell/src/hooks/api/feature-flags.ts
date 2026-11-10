import {featureFlagsResponseSchema} from '@shipfox/api-common-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type BooleanFlagDefinition,
  type ConfigFlagDefinition,
  checkFlagValue,
  type FlagDefinition,
} from '@shipfox/feature-flags';
import {type QueryClient, queryOptions, useQuery} from '@tanstack/react-query';
import {useMaybeActiveWorkspace} from '#runtime/active-workspace.js';
import {useAuthState} from '#runtime/auth.js';

/** How often a mounted tab asks again. It bounds how long a flip takes to reach a focused tab. */
const FEATURE_FLAGS_REFRESH_MS = 60_000;

export type FeatureFlagValues = Readonly<Record<string, unknown>>;

export interface FeatureFlagsSubject {
  userId?: string | undefined;
  workspaceId?: string | undefined;
}

function featureFlagsQueryKey({userId, workspaceId}: FeatureFlagsSubject) {
  return ['feature-flags', userId ?? null, workspaceId ?? null] as const;
}

async function fetchFeatureFlags(
  workspaceId: string | undefined,
  signal: AbortSignal,
): Promise<FeatureFlagValues> {
  const query =
    workspaceId === undefined ? '' : `?${new URLSearchParams({workspace_id: workspaceId})}`;
  const response = await checkedApiRequest(featureFlagsResponseSchema, `/feature-flags${query}`, {
    signal,
  });
  return response.flags;
}

/** The client-visible flags for a user, and for a workspace when one is given. */
export function featureFlagsQueryOptions(subject: FeatureFlagsSubject) {
  return queryOptions({
    queryKey: featureFlagsQueryKey(subject),
    queryFn: ({signal}) => fetchFeatureFlags(subject.workspaceId, signal),
    staleTime: FEATURE_FLAGS_REFRESH_MS,
    refetchInterval: FEATURE_FLAGS_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Reads a flag declared with `client: true` for the signed-in user and the active workspace.
 * Returns the definition's default while the flags load, when they never loaded, and when the
 * server sends a value of the wrong type. A failed refetch keeps the last value.
 */
export function useFlag(definition: BooleanFlagDefinition): boolean;
export function useFlag<Value>(definition: ConfigFlagDefinition<Value>): Value;
export function useFlag(definition: FlagDefinition): unknown {
  const auth = useAuthState();
  const workspace = useMaybeActiveWorkspace();
  const {data} = useQuery({
    ...featureFlagsQueryOptions({userId: auth.user?.id, workspaceId: workspace?.id}),
    enabled: auth.isAuthenticated,
  });
  if (data === undefined || !Object.hasOwn(data, definition.key)) return definition.default;
  const checked = checkFlagValue(definition, data[definition.key]);
  return checked.ok ? checked.value : definition.default;
}

/**
 * Seeds the flags `useFlag` reads, so a test needs no `/feature-flags` request. Pass the user and
 * workspace the test signs in with. Unlisted flags read their default.
 */
export function seedFeatureFlags(
  queryClient: QueryClient,
  params: FeatureFlagsSubject & {flags: FeatureFlagValues},
): void {
  queryClient.setQueryData(featureFlagsQueryKey(params), params.flags);
}

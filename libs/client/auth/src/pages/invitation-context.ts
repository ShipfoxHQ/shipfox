import type {
  PreviewInvitationPendingDto,
  PreviewInvitationResponseDto,
} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';

const INVITATION_ACCEPT_PATH = '/invitations/accept';

/**
 * Extract an invitation token from a `redirect=` URL if it points at the
 * canonical pre-auth invitation page. Returns undefined when the redirect is
 * absent, malformed, or unrelated to invitations.
 */
export function extractInvitationToken(redirect: unknown): string | undefined {
  if (typeof redirect !== 'string') return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(redirect);
  } catch {
    return undefined;
  }
  if (!decoded.startsWith('/')) return undefined;
  const [path, queryString = ''] = decoded.split('?', 2);
  if (path !== INVITATION_ACCEPT_PATH) return undefined;
  const params = new URLSearchParams(queryString);
  const token = params.get('token');
  return token && token.length > 0 ? token : undefined;
}

async function fetchPreview(token: string): Promise<PreviewInvitationResponseDto> {
  const params = new URLSearchParams({token});
  return await apiRequest<PreviewInvitationResponseDto>(
    `/invitations/preview?${params.toString()}`,
  );
}

export function pendingInvitation(
  data: PreviewInvitationResponseDto | undefined,
): PreviewInvitationPendingDto | undefined {
  return data?.status === 'pending' ? data : undefined;
}

/**
 * Mirrors the hook in `@shipfox/client-invitations` but lives in `client-auth`
 * to avoid a circular dependency. Signup/login pages call this to lock the
 * email field when arriving from an invitation link.
 */
export function useInvitationContext(token: string | undefined) {
  return useQuery({
    queryKey: ['invitations', 'preview', token ?? ''] as const,
    queryFn: () => fetchPreview(token as string),
    enabled: Boolean(token),
    retry: false,
    staleTime: 30_000,
  });
}

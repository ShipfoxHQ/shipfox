import type {
  PreviewInvitationPendingDto,
  PreviewInvitationResponseDto,
} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';
import {parseRedirectContext} from '#/components/redirect-context.js';

export function extractInvitationToken(redirect: unknown): string | undefined {
  return parseRedirectContext(redirect).invitationToken;
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

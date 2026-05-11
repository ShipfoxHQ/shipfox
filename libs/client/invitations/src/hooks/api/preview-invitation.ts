import type {PreviewInvitationResponseDto} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';

export const previewInvitationQueryKey = (token: string) =>
  ['invitations', 'preview', token] as const;

async function previewInvitation(token: string): Promise<PreviewInvitationResponseDto> {
  const params = new URLSearchParams({token});
  return await apiRequest<PreviewInvitationResponseDto>(
    `/invitations/preview?${params.toString()}`,
  );
}

export function usePreviewInvitation(token: string | undefined) {
  return useQuery({
    queryKey: previewInvitationQueryKey(token ?? ''),
    queryFn: () => previewInvitation(token as string),
    enabled: Boolean(token),
    retry: false,
    staleTime: 30_000,
  });
}

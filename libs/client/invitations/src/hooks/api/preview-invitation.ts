import {previewInvitationResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQuery} from '@tanstack/react-query';
import type {InvitationPreview} from '#core/invitation-preview.js';
import {toInvitationPreview} from './invitation-preview-mapper.js';

export const previewInvitationQueryKey = (token: string) =>
  ['invitations', 'preview', token] as const;

async function previewInvitation(token: string): Promise<InvitationPreview> {
  const params = new URLSearchParams({token});
  const response = await checkedApiRequest(
    previewInvitationResponseSchema,
    `/invitations/preview?${params.toString()}`,
  );
  return toInvitationPreview(response);
}

export function previewInvitationQueryOptions(token: string) {
  return queryOptions({
    queryKey: previewInvitationQueryKey(token),
    queryFn: () => previewInvitation(token),
    enabled: Boolean(token),
    retry: false,
    staleTime: 30_000,
  });
}

export function usePreviewInvitation(token: string | undefined) {
  return useQuery(previewInvitationQueryOptions(token ?? ''));
}

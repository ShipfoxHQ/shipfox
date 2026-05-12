import type {
  AcceptInvitationBodyDto,
  AcceptInvitationResponseDto,
} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';

async function acceptInvitation(body: AcceptInvitationBodyDto) {
  return await apiRequest<AcceptInvitationResponseDto>('/invitations/accept', {
    method: 'POST',
    body,
  });
}

export function useAcceptInvitation() {
  return useMutation({mutationFn: acceptInvitation});
}

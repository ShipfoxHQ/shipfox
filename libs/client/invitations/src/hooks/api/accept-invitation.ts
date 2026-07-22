import {acceptInvitationResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {toInvitationAcceptance} from './invitation-acceptance-mapper.js';

async function acceptInvitation(command: {token: string}) {
  const response = await checkedApiRequest(acceptInvitationResponseSchema, '/invitations/accept', {
    method: 'POST',
    body: command,
  });
  return toInvitationAcceptance(response);
}

export function useAcceptInvitation() {
  return useMutation({mutationFn: acceptInvitation});
}

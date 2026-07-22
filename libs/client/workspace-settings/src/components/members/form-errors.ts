import {ApiError} from '@shipfox/client-api';

export type InvitationField = 'email';

export type InvitationFormErrorMapping =
  | {kind: 'field'; field: InvitationField; message: string}
  | {kind: 'form'; message: string};

export function invitationErrorToFormError(error: unknown): InvitationFormErrorMapping {
  if (error instanceof ApiError) {
    if (error.code === 'open-invitation-exists') {
      return {
        kind: 'field',
        field: 'email',
        message: 'An open invitation already exists for this email.',
      };
    }
    if (error.code === 'rate-limited') {
      return {kind: 'form', message: 'Too many invitations were sent. Try again shortly.'};
    }
    return {kind: 'form', message: error.message};
  }
  if (error instanceof Error) return {kind: 'form', message: error.message};
  return {kind: 'form', message: 'Could not send invitation.'};
}

export function memberRemovalErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'self-removal-not-allowed') return "You can't remove yourself.";
    if (error.code === 'last-member') return 'Cannot remove the last member.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Could not remove member.';
}

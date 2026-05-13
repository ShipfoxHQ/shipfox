import {ApiError} from '@shipfox/client-api';

export type InvitationField = 'email';

export type InvitationFormErrorMapping =
  | {kind: 'field'; field: InvitationField; message: string}
  | {kind: 'form'; message: string};

export function invitationErrorToFormError(error: unknown): InvitationFormErrorMapping {
  if (error instanceof ApiError && error.code === 'open-invitation-exists') {
    return {
      kind: 'field',
      field: 'email',
      message: 'An open invitation already exists for this email.',
    };
  }
  if (error instanceof ApiError) {
    return {kind: 'form', message: error.message};
  }
  if (error instanceof Error) {
    return {kind: 'form', message: error.message};
  }
  return {kind: 'form', message: 'Could not send invitation.'};
}

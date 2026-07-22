import type {SignupResponseDto} from '@shipfox/api-auth-dto';
import {
  toAuthenticatedSession,
  toUserIdentity,
  type UserIdentity,
} from '@shipfox/client-shell/runtime';

export {toAuthenticatedSession};

export interface SignupResult {
  user: UserIdentity;
  emailChallenge?: {id: string; nextResendAvailableAt: string};
  membership?: {id: string; userId: string; workspaceId: string};
  acceptError?: {code: string; message: string};
}

export function toSignupResult(dto: SignupResponseDto): SignupResult {
  return {
    user: toUserIdentity(dto.user),
    ...(dto.email_challenge
      ? {
          emailChallenge: {
            id: dto.email_challenge.id,
            nextResendAvailableAt: dto.email_challenge.next_resend_available_at,
          },
        }
      : {}),
    ...(dto.membership
      ? {
          membership: {
            id: dto.membership.id,
            userId: dto.membership.user_id,
            workspaceId: dto.membership.workspace_id,
          },
        }
      : {}),
    ...(dto.accept_error ? {acceptError: dto.accept_error} : {}),
  };
}

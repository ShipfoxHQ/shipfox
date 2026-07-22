import type {SignupResponseDto} from '@shipfox/api-auth-dto';
import {toAuthenticatedSession, toUserIdentity} from '@shipfox/client-shell/runtime';
import type {SignupResult} from '#core/auth.js';

export {toAuthenticatedSession};

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

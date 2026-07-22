import type {SignupResponseDto} from '@shipfox/api-auth-dto';
import {toSignupResult} from './auth-mapper.js';

const baseUser: SignupResponseDto['user'] = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'signup@example.com',
  name: null,
  email_verified_at: null,
  status: 'active',
  created_at: '2026-04-27T00:00:00.000Z',
  updated_at: '2026-04-27T00:00:00.000Z',
};

describe('toSignupResult', () => {
  test('maps only the user when no challenge, membership, or accept error is present', () => {
    const result = toSignupResult({user: baseUser});

    expect(result).toEqual({user: {id: baseUser.id, email: baseUser.email}});
  });

  test('maps the user name and email verification when present', () => {
    const result = toSignupResult({
      user: {...baseUser, name: 'Ada', email_verified_at: '2026-04-27T00:00:00.000Z'},
    });

    expect(result.user).toEqual({
      id: baseUser.id,
      email: baseUser.email,
      name: 'Ada',
      emailVerifiedAt: '2026-04-27T00:00:00.000Z',
    });
  });

  test('maps the email challenge into camelCase fields', () => {
    const result = toSignupResult({
      user: baseUser,
      email_challenge: {
        id: '22222222-2222-4222-8222-222222222222',
        next_resend_available_at: '2026-04-27T00:01:00.000Z',
      },
    });

    expect(result.emailChallenge).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      nextResendAvailableAt: '2026-04-27T00:01:00.000Z',
    });
  });

  test('maps the invitation membership into camelCase fields', () => {
    const result = toSignupResult({
      user: baseUser,
      membership: {
        id: '33333333-3333-4333-8333-333333333333',
        user_id: baseUser.id,
        workspace_id: '44444444-4444-4444-8444-444444444444',
      },
    });

    expect(result.membership).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      userId: baseUser.id,
      workspaceId: '44444444-4444-4444-8444-444444444444',
    });
  });

  test('maps the invitation accept error as-is', () => {
    const result = toSignupResult({
      user: baseUser,
      accept_error: {code: 'invitation-expired', message: 'This invitation has expired.'},
    });

    expect(result.acceptError).toEqual({
      code: 'invitation-expired',
      message: 'This invitation has expired.',
    });
  });
});

import type {LoginResponseDto, UserDto} from '@shipfox/api-auth-dto';
import {toAuthenticatedSession, toUserIdentity} from './session-mapper.js';

const baseUser: UserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: null,
  email_verified_at: null,
  status: 'active',
  created_at: '2026-04-27T00:00:00.000Z',
  updated_at: '2026-04-27T00:00:00.000Z',
};

describe('toUserIdentity', () => {
  test('omits name and emailVerifiedAt when the DTO carries neither', () => {
    expect(toUserIdentity(baseUser)).toEqual({id: baseUser.id, email: baseUser.email});
  });

  test('maps name and email_verified_at into camelCase when present', () => {
    const identity = toUserIdentity({
      ...baseUser,
      name: 'Ada',
      email_verified_at: '2026-04-27T00:00:00.000Z',
    });

    expect(identity).toEqual({
      id: baseUser.id,
      email: baseUser.email,
      name: 'Ada',
      emailVerifiedAt: '2026-04-27T00:00:00.000Z',
    });
  });
});

describe('toAuthenticatedSession', () => {
  test('maps the token to accessToken and the user through toUserIdentity', () => {
    const dto: LoginResponseDto = {token: 'access-token', user: baseUser};

    expect(toAuthenticatedSession(dto)).toEqual({
      accessToken: 'access-token',
      user: {id: baseUser.id, email: baseUser.email},
    });
  });
});

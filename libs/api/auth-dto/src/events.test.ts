import {
  AUTH_PASSWORD_RESET_SEND_REQUESTED,
  AUTH_USER_SIGNED_IN,
  AUTH_USER_SIGNED_UP,
  type AuthEventMap,
  authEventSchemas,
  authUserSignedInSchema,
} from './events.js';

describe('Auth event contracts', () => {
  test('registers the signed-in event with its public payload shape', () => {
    const userId = crypto.randomUUID();

    expect(Object.keys(authEventSchemas).sort()).toEqual([
      AUTH_PASSWORD_RESET_SEND_REQUESTED,
      AUTH_USER_SIGNED_IN,
      AUTH_USER_SIGNED_UP,
    ]);
    expect(authUserSignedInSchema.parse({userId})).toEqual({userId});
    expect(
      authUserSignedInSchema.parse({userId}) satisfies AuthEventMap[typeof AUTH_USER_SIGNED_IN],
    ).toEqual({userId});
  });

  test('rejects non-UUID and sensitive fields', () => {
    expect(() => authUserSignedInSchema.parse({userId: 'not-a-uuid'})).toThrow();
    expect(() =>
      authUserSignedInSchema.parse({userId: crypto.randomUUID(), password: 'secret'}),
    ).toThrow();
  });
});

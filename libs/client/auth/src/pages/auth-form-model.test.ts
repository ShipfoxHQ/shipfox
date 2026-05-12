import {
  parseLoginForm,
  parsePasswordResetConfirmForm,
  parsePasswordResetRequestForm,
  parseSignupForm,
} from './auth-form-model.js';

describe('auth form model', () => {
  test('normalizes a valid login payload', () => {
    const result = parseLoginForm({
      email: 'Login@Example.com',
      password: 'correct horse',
    });

    expect(result).toEqual({
      ok: true,
      body: {
        email: 'login@example.com',
        password: 'correct horse',
      },
    });
  });

  test('returns login field errors without rendering the login page', () => {
    const result = parseLoginForm({email: '', password: ''});

    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        email: 'Invalid email address',
        password: 'Too small: expected string to have >=1 characters',
      },
    });
  });

  test('trims optional signup names and normalizes email', () => {
    const result = parseSignupForm({
      email: 'New@Example.com',
      password: 'long secure password',
      name: '  New User  ',
    });

    expect(result).toEqual({
      ok: true,
      body: {
        email: 'new@example.com',
        password: 'long secure password',
        name: 'New User',
      },
    });
  });

  test('omits blank signup names', () => {
    const result = parseSignupForm({
      email: 'new@example.com',
      password: 'long secure password',
      name: '   ',
    });

    expect(result).toEqual({
      ok: true,
      body: {
        email: 'new@example.com',
        password: 'long secure password',
      },
    });
  });

  test('preserves signup invitation tokens', () => {
    const result = parseSignupForm({
      email: 'new@example.com',
      password: 'long secure password',
      name: 'New User',
      invitationToken: 'inv-token',
    });

    expect(result).toEqual({
      ok: true,
      body: {
        email: 'new@example.com',
        password: 'long secure password',
        name: 'New User',
        invitation_token: 'inv-token',
      },
    });
  });

  test('normalizes password reset request emails', () => {
    const result = parsePasswordResetRequestForm({email: 'Reset@Example.com'});

    expect(result).toEqual({
      ok: true,
      body: {email: 'reset@example.com'},
    });
  });

  test('returns password reset confirmation field errors', () => {
    const result = parsePasswordResetConfirmForm({
      token: 'reset-token',
      newPassword: 'short',
    });

    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        new_password: 'Too small: expected string to have >=12 characters',
      },
    });
  });

  test('normalizes password reset confirmation payloads', () => {
    const result = parsePasswordResetConfirmForm({
      token: 'reset-token',
      newPassword: 'new password is long',
    });

    expect(result).toEqual({
      ok: true,
      body: {
        token: 'reset-token',
        new_password: 'new password is long',
      },
    });
  });
});

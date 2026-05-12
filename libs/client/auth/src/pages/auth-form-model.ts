import {
  type LoginBodyDto,
  loginBodySchema,
  type PasswordResetConfirmBodyDto,
  type PasswordResetRequestBodyDto,
  passwordResetConfirmBodySchema,
  passwordResetRequestBodySchema,
  type SignupBodyDto,
  signupBodySchema,
} from '@shipfox/api-auth-dto';
import {type FieldErrors, fieldErrorsFromZod} from './form-utils.js';

type FormResult<TBody, TField extends string> =
  | {ok: true; body: TBody}
  | {ok: false; fieldErrors: FieldErrors<TField>};

export function parseLoginForm(input: {
  email: string;
  password: string;
}): FormResult<LoginBodyDto, 'email' | 'password'> {
  const parsed = loginBodySchema.safeParse(input);
  if (!parsed.success) {
    return {ok: false, fieldErrors: fieldErrorsFromZod(parsed.error)};
  }

  return {ok: true, body: parsed.data};
}

export function parseSignupForm(input: {
  email: string;
  password: string;
  name: string;
  invitationToken?: string;
}): FormResult<SignupBodyDto, 'email' | 'password' | 'name'> {
  const parsed = signupBodySchema.safeParse({
    email: input.email,
    password: input.password,
    name: input.name.trim() ? input.name.trim() : undefined,
    ...(input.invitationToken ? {invitation_token: input.invitationToken} : {}),
  });
  if (!parsed.success) {
    return {ok: false, fieldErrors: fieldErrorsFromZod(parsed.error)};
  }

  return {ok: true, body: parsed.data};
}

export function parsePasswordResetRequestForm(input: {
  email: string;
}): FormResult<PasswordResetRequestBodyDto, 'email'> {
  const parsed = passwordResetRequestBodySchema.safeParse(input);
  if (!parsed.success) {
    return {ok: false, fieldErrors: fieldErrorsFromZod(parsed.error)};
  }

  return {ok: true, body: parsed.data};
}

export function parsePasswordResetConfirmForm(input: {
  token: string;
  newPassword: string;
}): FormResult<PasswordResetConfirmBodyDto, 'new_password'> {
  const parsed = passwordResetConfirmBodySchema.safeParse({
    token: input.token,
    new_password: input.newPassword,
  });
  if (!parsed.success) {
    return {ok: false, fieldErrors: fieldErrorsFromZod(parsed.error)};
  }

  return {ok: true, body: parsed.data};
}

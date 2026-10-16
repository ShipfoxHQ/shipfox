import {ApiError} from '@shipfox/client-api';

export type CredentialFormErrorMapping<Field extends string> =
  | {kind: 'field'; field: Field; message: string}
  | {kind: 'form'; message: string};

export type CredentialConnectFormErrorMapping<Field extends string> =
  | CredentialFormErrorMapping<Field>
  | {kind: 'already-connected'; connectionId: string};

/** Copy for one provider's pasted-credential forms. */
export interface CredentialFormMessages<Field extends string> {
  /** The form field that holds the credential. */
  field: Field;
  /** Codes shown on the credential field. */
  fieldMessages: Readonly<Record<string, string>>;
  /** Codes shown above the form. Must include `already-connected`, for a 409 without its connection. */
  formMessages: Readonly<Record<string, string>> & {'already-connected': string};
}

const COMMON_FORM_MESSAGES: Readonly<Record<string, string>> = {
  forbidden: 'You do not have permission to manage this integration connection.',
  'network-error': "We couldn't reach the server. Check your connection and try again.",
};
const FALLBACK_MESSAGE = 'Something went wrong. Try again.';

export function credentialConnectErrorToFormError<Field extends string>(
  error: unknown,
  messages: CredentialFormMessages<Field>,
): CredentialConnectFormErrorMapping<Field> {
  const alreadyConnectedId = alreadyConnectedConnectionId(error);
  if (alreadyConnectedId) return {kind: 'already-connected', connectionId: alreadyConnectedId};
  return credentialErrorToFormError(error, messages);
}

export function credentialErrorToFormError<Field extends string>(
  error: unknown,
  messages: CredentialFormMessages<Field>,
): CredentialFormErrorMapping<Field> {
  const code = error instanceof ApiError ? error.code : '';
  const fieldMessage = lookup(messages.fieldMessages, code);
  if (fieldMessage) return {kind: 'field', field: messages.field, message: fieldMessage};
  const formMessage = lookup(messages.formMessages, code) ?? lookup(COMMON_FORM_MESSAGES, code);
  return {kind: 'form', message: formMessage ?? FALLBACK_MESSAGE};
}

function lookup(messages: Readonly<Record<string, string>>, code: string): string | undefined {
  return Object.hasOwn(messages, code) ? messages[code] : undefined;
}

function alreadyConnectedConnectionId(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code !== 'already-connected') return undefined;
  if (!isRecord(error.details)) return undefined;
  const details = error.details.details;
  if (!isRecord(details)) return undefined;
  const connectionId = details.connection_id;
  return typeof connectionId === 'string' && connectionId.length > 0 ? connectionId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

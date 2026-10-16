import {ApiError} from '@shipfox/client-api';

export type ClaapFormErrorMapping =
  | {kind: 'field'; field: 'apiKey'; message: string}
  | {kind: 'form'; message: string};

export type ClaapConnectFormErrorMapping =
  | ClaapFormErrorMapping
  | {kind: 'already-connected'; connectionId: string};

const KEY_MESSAGES: Readonly<Record<string, string>> = {
  'invalid-api-key-prefix': 'Use a Claap API key that starts with cla_.',
  'invalid-api-key': 'Claap did not accept this key. Check that it is active and copied in full.',
  'unexpected-workspace-count':
    'This key does not belong to exactly one Claap workspace. Create a key in the workspace to connect.',
  'workspace-mismatch':
    'This key belongs to another Claap workspace. Use a key from the connected workspace.',
};
const FORM_MESSAGES: Readonly<Record<string, string>> = {
  'rate-limited': 'Claap received too many requests. Wait a moment and try again.',
  'provider-unavailable': 'Claap is unavailable. Try again later.',
  timeout: 'Claap took too long to respond. Try again.',
  'malformed-provider-response': 'Claap returned an unexpected response. Try again later.',
  'provider-rejected': 'Claap rejected the request. Check the setup guide and try again.',
  'credential-version-conflict':
    'The API key changed while you were replacing it. Refresh the page and try again.',
  'not-found': 'This Claap integration connection is unavailable. Refresh the page and try again.',
  forbidden: 'You do not have permission to manage this integration connection.',
  'network-error': "We couldn't reach the server. Check your connection and try again.",
};

export function claapConnectErrorToFormError(error: unknown): ClaapConnectFormErrorMapping {
  const alreadyConnectedId = alreadyConnectedConnectionId(error);
  if (alreadyConnectedId) return {kind: 'already-connected', connectionId: alreadyConnectedId};
  return mapFormError(error);
}

export function claapReplaceErrorToFormError(error: unknown): ClaapFormErrorMapping {
  return mapFormError(error);
}

function mapFormError(error: unknown): ClaapFormErrorMapping {
  const code = error instanceof ApiError ? error.code : '';
  const keyMessage = Object.hasOwn(KEY_MESSAGES, code) ? KEY_MESSAGES[code] : undefined;
  if (keyMessage) return {kind: 'field', field: 'apiKey', message: keyMessage};
  const formMessage = Object.hasOwn(FORM_MESSAGES, code) ? FORM_MESSAGES[code] : undefined;
  return {kind: 'form', message: formMessage ?? 'Something went wrong. Try again.'};
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

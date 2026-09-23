import {ApiError} from '@shipfox/client-api';

export type PosthogConnectField = 'region' | 'apiKey';

export type PosthogFormErrorMapping =
  | {kind: 'field'; field: PosthogConnectField; message: string}
  | {kind: 'form'; message: string}
  | {kind: 'already-connected'; connectionId: string};

const KEY_MESSAGES: Readonly<Record<string, string>> = {
  'invalid-api-key-prefix': 'Use a PostHog personal API key that starts with phx_.',
  'credentials-unavailable':
    'PostHog rejected this key. Check the region and use an active personal API key.',
  'access-denied':
    'PostHog denied access. Check the key permissions and the service user’s project access.',
  'missing-required-scopes':
    'This key is missing required read scopes. Add the ten scopes listed in the PostHog setup guide.',
  'no-project-access': 'This key cannot access any PostHog projects. Check its project access.',
  'project-not-accessible':
    'This key cannot access the selected PostHog project. Check its project access.',
  'project-mismatch': 'This key cannot access the connected PostHog project.',
};
const FORM_MESSAGES: Readonly<Record<string, string>> = {
  'rate-limited': 'PostHog received too many requests. Wait a moment and try again.',
  'provider-unavailable': 'PostHog is unavailable. Try again later.',
  timeout: 'PostHog took too long to respond. Try again.',
  'malformed-provider-response': 'PostHog returned an unexpected response. Try again later.',
  'provider-rejected': 'PostHog rejected the request. Check the setup guide and try again.',
  'credential-version-conflict':
    'The API key changed while you were replacing it. Refresh the page and try again.',
  'not-found':
    'This PostHog integration connection is unavailable. Refresh the page and try again.',
  forbidden: 'You do not have permission to manage this integration connection.',
  'network-error': "We couldn't reach the server. Check your connection and try again.",
};

export function posthogConnectErrorToFormError(error: unknown): PosthogFormErrorMapping {
  const alreadyConnectedId = alreadyConnectedConnectionId(error);
  if (alreadyConnectedId) return {kind: 'already-connected', connectionId: alreadyConnectedId};
  return mapFormError(error);
}

export function posthogReplaceErrorToFormError(
  error: unknown,
): {kind: 'field'; field: 'apiKey'; message: string} | {kind: 'form'; message: string} {
  return mapFormError(error);
}

function mapFormError(
  error: unknown,
): {kind: 'field'; field: 'apiKey'; message: string} | {kind: 'form'; message: string} {
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

import {ApiError} from '@shipfox/client-api';

export type PosthogConnectField = 'region' | 'apiKey';

export type PosthogFormErrorMapping =
  | {kind: 'field'; field: PosthogConnectField; message: string}
  | {kind: 'form'; message: string}
  | {kind: 'already-connected'; connectionId: string};

const INVALID_KEY_CODES = new Set([
  'invalid-api-key',
  'posthog-invalid-api-key',
  'posthog-api-key-invalid',
  'posthog-api-key-prefix-invalid',
]);
const CREDENTIAL_ERROR_CODES = new Set([
  ...INVALID_KEY_CODES,
  'credentials-unavailable',
  'posthog-credentials-unavailable',
]);
const KEY_PERMISSION_CODES = new Set([
  'posthog-permission-denied',
  'posthog-provider-rejected',
  'provider-rejected',
]);
const KNOWN_MESSAGE_CODES = new Set([
  ...CREDENTIAL_ERROR_CODES,
  ...KEY_PERMISSION_CODES,
  'project-mismatch',
  'posthog-project-mismatch',
  'posthog-zero-projects',
  'provider-unavailable',
  'timeout',
]);

export function posthogConnectErrorToFormError(error: unknown): PosthogFormErrorMapping {
  const alreadyConnectedId = alreadyConnectedConnectionId(error);
  if (alreadyConnectedId) return {kind: 'already-connected', connectionId: alreadyConnectedId};

  const code = error instanceof ApiError ? error.code : undefined;
  if (code === 'invalid-region' || code === 'posthog-invalid-region') {
    return {kind: 'field', field: 'region', message: 'Choose a PostHog region.'};
  }
  if (CREDENTIAL_ERROR_CODES.has(code ?? '')) {
    return {
      kind: 'field',
      field: 'apiKey',
      message: 'Use a PostHog personal API key that starts with phx_.',
    };
  }
  if (KEY_PERMISSION_CODES.has(code ?? '')) {
    return {kind: 'field', field: 'apiKey', message: apiErrorMessage(error)};
  }

  return {kind: 'form', message: apiErrorMessage(error)};
}

export function posthogReplaceErrorToFormError(
  error: unknown,
): {kind: 'field'; field: 'apiKey'; message: string} | {kind: 'form'; message: string} {
  const code = error instanceof ApiError ? error.code : undefined;
  if (CREDENTIAL_ERROR_CODES.has(code ?? '')) {
    return {
      kind: 'field',
      field: 'apiKey',
      message: 'Use a PostHog personal API key that starts with phx_.',
    };
  }
  if (code === 'project-mismatch' || code === 'posthog-project-mismatch') {
    return {
      kind: 'field',
      field: 'apiKey',
      message: 'This key cannot access the connected PostHog project.',
    };
  }
  if (KEY_PERMISSION_CODES.has(code ?? '')) {
    return {kind: 'field', field: 'apiKey', message: apiErrorMessage(error)};
  }
  return {kind: 'form', message: apiErrorMessage(error)};
}

function alreadyConnectedConnectionId(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code !== 'already-connected' && error.status !== 409) return undefined;
  const details = error.details;
  if (!isRecord(details)) return undefined;
  const connectionId = details.connection_id;
  return typeof connectionId === 'string' && connectionId.length > 0 ? connectionId : undefined;
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network-error') {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    if (KNOWN_MESSAGE_CODES.has(error.code)) {
      return error.message || 'PostHog rejected the request. Check the key and try again.';
    }
    return 'Something went wrong. Try again.';
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Try again.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

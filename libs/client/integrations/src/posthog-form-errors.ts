import {
  type CredentialConnectFormErrorMapping,
  type CredentialFormErrorMapping,
  type CredentialFormMessages,
  credentialConnectErrorToFormError,
  credentialErrorToFormError,
} from '#credential-form-errors.js';

export type PosthogConnectField = 'region' | 'apiKey';

export type PosthogFormErrorMapping = CredentialConnectFormErrorMapping<PosthogConnectField>;

const POSTHOG_MESSAGES: CredentialFormMessages<'apiKey'> = {
  field: 'apiKey',
  fieldMessages: {
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
  },
  formMessages: {
    'already-connected':
      'This PostHog project is already connected. Refresh the page and replace the API key on its integration connection.',
    'rate-limited': 'PostHog received too many requests. Wait a moment and try again.',
    'provider-unavailable': 'PostHog is unavailable. Try again later.',
    timeout: 'PostHog took too long to respond. Try again.',
    'malformed-provider-response': 'PostHog returned an unexpected response. Try again later.',
    'provider-rejected': 'PostHog rejected the request. Check the setup guide and try again.',
    'credential-version-conflict':
      'The API key changed while you were replacing it. Refresh the page and try again.',
    'not-found':
      'This PostHog integration connection is unavailable. Refresh the page and try again.',
  },
};

export function posthogConnectErrorToFormError(error: unknown): PosthogFormErrorMapping {
  return credentialConnectErrorToFormError(error, POSTHOG_MESSAGES);
}

export function posthogReplaceErrorToFormError(
  error: unknown,
): CredentialFormErrorMapping<'apiKey'> {
  return credentialErrorToFormError(error, POSTHOG_MESSAGES);
}

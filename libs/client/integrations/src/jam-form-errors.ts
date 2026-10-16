import {
  type CredentialConnectFormErrorMapping,
  type CredentialFormErrorMapping,
  type CredentialFormMessages,
  credentialConnectErrorToFormError,
  credentialErrorToFormError,
} from '#credential-form-errors.js';

const JAM_MESSAGES: CredentialFormMessages<'token'> = {
  field: 'token',
  fieldMessages: {
    'invalid-token-prefix': 'Use a Jam personal access token that starts with jam_pat_.',
    'invalid-token': 'Jam rejected this token. It may have expired or been revoked.',
    'missing-read-scope':
      'This token has no MCP access. Create a token with MCP read access, not CLI access only.',
    'mcp-unavailable':
      'Jam did not let this token read Jams over MCP. Check its MCP read access and try again.',
    'workspace-mismatch':
      'This token belongs to another Jam workspace. Use a token from the connected workspace.',
  },
  formMessages: {
    'already-connected':
      'This Jam workspace is already connected. Refresh the page and replace the token on its integration connection.',
    'rate-limited': 'Jam received too many requests. Wait a moment and try again.',
    'provider-unavailable': 'Jam is unavailable. Try again later.',
    timeout: 'Jam took too long to respond. Try again.',
    'malformed-provider-response': 'Jam returned an unexpected response. Try again later.',
    'provider-rejected': 'Jam rejected the request. Check the setup guide and try again.',
    'credential-version-conflict':
      'The token changed while you were replacing it. Refresh the page and try again.',
    'not-found': 'This Jam integration connection is unavailable. Refresh the page and try again.',
  },
};

export function jamConnectErrorToFormError(
  error: unknown,
): CredentialConnectFormErrorMapping<'token'> {
  return credentialConnectErrorToFormError(error, JAM_MESSAGES);
}

export function jamReplaceErrorToFormError(error: unknown): CredentialFormErrorMapping<'token'> {
  return credentialErrorToFormError(error, JAM_MESSAGES);
}

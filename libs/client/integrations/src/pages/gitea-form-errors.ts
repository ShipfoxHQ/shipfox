import {ApiError} from '@shipfox/client-api';

export type GiteaConnectField = 'org';

export type GiteaConnectFormErrorMapping =
  | {kind: 'field'; field: GiteaConnectField; message: string}
  | {kind: 'form'; message: string};

export function giteaConnectErrorToFormError(error: unknown): GiteaConnectFormErrorMapping {
  const code = error instanceof ApiError ? error.code : undefined;

  if (code === 'gitea-organization-not-found') {
    return {
      kind: 'field',
      field: 'org',
      message: "We couldn't find that organization on Gitea. Check the name and try again.",
    };
  }
  if (code === 'gitea-org-already-linked') {
    return {kind: 'field', field: 'org', message: 'That organization is already installed.'};
  }

  return {kind: 'form', message: giteaConnectErrorMessage(error)};
}

function giteaConnectErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // `network-error` carries the raw request URL in its message; never surface it.
    if (error.code === 'network-error') {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Try again.';
}

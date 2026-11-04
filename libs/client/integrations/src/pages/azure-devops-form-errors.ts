import {ApiError} from '@shipfox/client-api';

export type AzureDevOpsConnectField = 'organization' | 'token';

export type AzureDevOpsConnectFormErrorMapping =
  | {kind: 'field'; field: AzureDevOpsConnectField; message: string}
  | {kind: 'form'; message: string};

export function azureDevOpsConnectErrorToFormError(
  error: unknown,
): AzureDevOpsConnectFormErrorMapping {
  const code = error instanceof ApiError ? error.code : undefined;

  if (code === 'azure-devops-credential-rejected') {
    return {
      kind: 'field',
      field: 'token',
      message:
        'Azure DevOps rejected this token. Check the organization, and that the token has Code (read & write) and Pull Request Threads access.',
    };
  }
  if (code === 'azure-devops-organization-already-linked') {
    return {
      kind: 'field',
      field: 'organization',
      message: 'That organization is already installed in another workspace.',
    };
  }

  return {kind: 'form', message: azureDevOpsConnectErrorMessage(error)};
}

function azureDevOpsConnectErrorMessage(error: unknown): string {
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

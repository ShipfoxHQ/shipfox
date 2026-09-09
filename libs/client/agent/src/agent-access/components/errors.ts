import {ApiError} from '@shipfox/client-api';

export function agentAccessErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';

  switch (error.code) {
    case 'network-error':
      return "We couldn't reach the server. Check your connection and try again.";
    case 'workspace-suspended':
      return 'This workspace is suspended. Restore it before managing the Shipfox MCP server.';
    case 'workspace-inactive':
      return 'This workspace is not active, so the Shipfox MCP server cannot be managed.';
    case 'forbidden':
      return "You don't have permission to manage the Shipfox MCP server for this workspace.";
    case 'auth-dependency-unavailable':
      return 'The Shipfox MCP server is temporarily unavailable. Try again in a moment.';
    case 'not-found':
      return 'This connected app no longer exists. Refresh the page to see the latest list.';
    default:
      return error.message;
  }
}

export function oauthConsentErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';

  switch (error.code) {
    case 'network-error':
      return "We couldn't reach the server. Check your connection and try again.";
    case 'workspace-suspended':
      return 'This workspace is suspended. Restore it before approving this access request.';
    case 'workspace-inactive':
      return 'This workspace is not active, so this access request cannot be approved.';
    case 'forbidden':
      return "You don't have permission to approve this access request for this workspace.";
    case 'auth-dependency-unavailable':
      return 'This access request is temporarily unavailable. Try again in a moment.';
    case 'not-found':
      return 'This access request expired or is no longer available. Return to your MCP client and start again.';
    case 'invalid-request':
      return 'This access request is invalid. Return to your MCP client and start again.';
    default:
      return error.message;
  }
}

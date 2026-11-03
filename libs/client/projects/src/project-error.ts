import {ApiError} from '@shipfox/client-api';

export interface ProjectErrorCopy {
  title: string;
  message: string;
  existingProjectId?: string | undefined;
  slugConflict?: boolean | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function apiDetails(error: ApiError): Record<string, unknown> {
  if (!isRecord(error.details)) return {};
  const details = error.details.details;
  return isRecord(details) ? details : {};
}

function stringDetail(error: ApiError, key: string): string | undefined {
  const value = apiDetails(error)[key];
  return typeof value === 'string' ? value : undefined;
}

function numberDetail(error: ApiError, key: string): number | undefined {
  const value = apiDetails(error)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function projectErrorCopy(error: unknown): ProjectErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Something went wrong',
      message: 'Try again in a moment.',
    };
  }

  if (error.code === 'network-error') {
    return {
      title: 'Network problem',
      message: 'We could not reach the API. Check your connection and try again.',
    };
  }
  if (error.code === 'repository-not-found') {
    return {
      title: 'Repository not found',
      message: 'Choose another repository and try again.',
    };
  }
  if (error.code === 'source-connection-not-found') {
    return {
      title: 'Source connection not found',
      message: 'Reconnect source control and try again.',
    };
  }
  if (error.code === 'source-connection-inactive') {
    return {
      title: 'Source connection inactive',
      message: 'Reconnect or choose another source-control connection.',
    };
  }
  if (error.code === 'access-denied') {
    return {
      title: 'Repository access denied',
      message: 'The selected connection cannot access this repository.',
    };
  }
  if (error.code === 'rate-limited') {
    const retryAfter = numberDetail(error, 'retry_after_seconds');
    return {
      title: 'Provider rate limited',
      message: retryAfter
        ? `Try again in about ${retryAfter} seconds.`
        : 'The provider is asking us to slow down. Try again shortly.',
    };
  }
  if (error.code === 'timeout') {
    return {
      title: 'Provider timed out',
      message: 'The provider did not respond in time. Try again.',
    };
  }
  if (error.code === 'provider-unavailable') {
    return {
      title: 'Provider unavailable',
      message: 'The provider is unavailable right now. Try again shortly.',
    };
  }
  if (error.code === 'malformed-provider-response') {
    return {
      title: 'Provider response changed',
      message: 'The provider returned data Shipfox could not understand.',
    };
  }
  if (error.code === 'project-already-exists') {
    return {
      title: 'Project already exists',
      message: 'This repository is already connected to a Shipfox project.',
      existingProjectId: stringDetail(error, 'existing_project_id'),
    };
  }
  if (error.code === 'slug-conflict') {
    return {
      title: 'Project slug already exists',
      message: 'Choose another slug and try again.',
      slugConflict: true,
    };
  }

  return {
    title: 'Project request failed',
    message: error.message || 'Try again in a moment.',
  };
}

/** Copy for a refused or stopped move to a repository. `repositoryName` names the target when known. */
export function configMoveErrorCopy(
  error: unknown,
  {repositoryName}: {repositoryName?: string | null | undefined} = {},
): ProjectErrorCopy {
  if (!(error instanceof ApiError)) return projectErrorCopy(error);
  const repository = repositoryName ?? 'this repository';

  switch (error.code) {
    case 'config-exists':
      return {
        title: 'Repository already has config',
        message: `${repository} already has a .shipfox/ directory on its default branch. Remove it, or pick another repository.`,
      };
    case 'repository-in-use':
      return {
        title: 'Repository already in use',
        message: `Another project already uses ${repository}. Pick another repository.`,
      };
    case 'repository-empty':
      return {
        title: 'Repository has no commits',
        message: `A pull request needs a base, and ${repository} has no commits. Push a first commit, or pick another repository.`,
      };
    case 'connection-inactive':
    case 'integration-connection-inactive':
      return {
        title: 'Connection inactive',
        message: 'Reconnect it from Integrations, or pick another connection.',
      };
    case 'link-unsupported':
      return {
        title: 'Connection not supported',
        message: 'Config can move to GitHub repositories only. Pick a GitHub connection.',
      };
    case 'access-denied':
    case 'provider-rejected':
      return {
        title: 'GitHub refused the pull request',
        message: `Give the Shipfox GitHub App write access to ${repository} in GitHub, then try again.`,
      };
    case 'repository-not-found':
      return {
        title: 'Repository not found',
        message: 'The connection can no longer see this repository. Pick another one.',
      };
    case 'pull-request-closed':
      return {
        title: 'Pull request closed',
        message:
          'The pull request was closed before the move finished, so the project stays managed by Shipfox. Start the move again to open a new one.',
      };
    case 'source-already-bound':
      return {
        title: 'Another project took this repository',
        message: `Another project moved to ${repository} first. Close the pull request this move opened on ${repository}.`,
      };
    case 'source-changed':
      return {
        title: 'Config source changed',
        message: "The project's config source changed during the move. Reload the page.",
      };
    case 'move-in-progress':
      return {
        title: 'A move is already running',
        message: 'Another member started moving this project. Reload the page to see where.',
      };
    case 'already-moved':
      return {
        title: 'Project already moved',
        message: "This project's config already lives in a repository. Reload the page.",
      };
    case 'project-not-managed':
      return {
        title: 'Project not managed by Shipfox',
        message: 'Only a project whose config Shipfox hosts can move to a repository.',
      };
    case 'no-pull-request':
      return {
        title: 'No config to add',
        message: 'The config Shipfox hosts has no files, so there is no pull request to open.',
      };
    case 'pull-request-not-closed':
      return {
        title: 'Pull request not closed',
        message: 'The current pull request is still open or merged. Reload the page.',
      };
    case 'move-unconfirmed':
      return {
        title: "We couldn't confirm the move",
        message:
          'The pull request may exist, so config stays read-only. Retry from this page in two minutes. A retry never opens a second pull request.',
      };
    case 'impersonation-not-permitted':
      return {
        title: 'Not available while impersonating',
        message: 'Only a workspace member can move a project.',
      };
    default:
      return projectErrorCopy(error);
  }
}

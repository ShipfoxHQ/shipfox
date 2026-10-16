import {isRecord} from '@shipfox/api-integration-spi';
import {githubGraphqlErrors} from '#api/client.js';
import {GithubIntegrationProviderError} from './errors.js';

const PULL_REQUEST_FIELDS = `
  number
  url
  state
  merged
  mergeCommit {
    oid
  }
  autoMergeRequest {
    mergeMethod
    enabledAt
  }
`;

export const GET_PULL_REQUEST_QUERY = `
  query GetPullRequest($owner: String!, $repo: String!, $pullNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pullNumber) {
        id
        ${PULL_REQUEST_FIELDS}
      }
    }
  }
`;

export const ENABLE_PULL_REQUEST_AUTO_MERGE_MUTATION = `
  mutation EnablePullRequestAutoMerge($input: EnablePullRequestAutoMergeInput!) {
    enablePullRequestAutoMerge(input: $input) {
      pullRequest {
        ${PULL_REQUEST_FIELDS}
      }
    }
  }
`;

export const DISABLE_PULL_REQUEST_AUTO_MERGE_MUTATION = `
  mutation DisablePullRequestAutoMerge($input: DisablePullRequestAutoMergeInput!) {
    disablePullRequestAutoMerge(input: $input) {
      pullRequest {
        ${PULL_REQUEST_FIELDS}
      }
    }
  }
`;

export const MERGE_PULL_REQUEST_MUTATION = `
  mutation MergePullRequest($input: MergePullRequestInput!) {
    mergePullRequest(input: $input) {
      pullRequest {
        ${PULL_REQUEST_FIELDS}
      }
    }
  }
`;

// GitHub refuses auto-merge when nothing blocks the merge, so enable then merges right away,
// which is what auto-merge would do. GitHub computes the merge status lazily, so a read made
// beforehand can still say UNKNOWN: only the refusal is reliable.
const IMMEDIATELY_MERGEABLE_PATTERN = /\bis in (clean|unstable|has_hooks) status\b/iu;

type GraphqlClient = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

export async function enablePullRequestAutoMerge(
  graphql: GraphqlClient,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const pullRequest = await readPullRequest(graphql, args);
  // A retry after a merge that already went through finds the pull request merged.
  if (pullRequest.state === 'MERGED') return autoMergeOutput(pullRequest);
  if (pullRequest.state !== 'OPEN') {
    throw new GithubIntegrationProviderError(
      'provider-rejected',
      `Pull request #${String(args.pull_number)} is ${String(pullRequest.state).toLowerCase()}`,
    );
  }

  const input: Record<string, unknown> = {pullRequestId: pullRequest.id};
  if (typeof args.merge_method === 'string') input.mergeMethod = args.merge_method.toUpperCase();
  if (args.commit_title !== undefined) input.commitHeadline = args.commit_title;
  if (args.commit_message !== undefined) input.commitBody = args.commit_message;

  try {
    const data = await graphql(ENABLE_PULL_REQUEST_AUTO_MERGE_MUTATION, {input});
    return autoMergeResult(data, 'enablePullRequestAutoMerge');
  } catch (error) {
    if (!isImmediatelyMergeable(error)) throw error;
  }
  const data = await graphql(MERGE_PULL_REQUEST_MUTATION, {input});
  return autoMergeResult(data, 'mergePullRequest');
}

export async function disablePullRequestAutoMerge(
  graphql: GraphqlClient,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const pullRequest = await readPullRequest(graphql, args);
  if (pullRequest.autoMergeRequest === null) return autoMergeOutput(pullRequest);
  const data = await graphql(DISABLE_PULL_REQUEST_AUTO_MERGE_MUTATION, {
    input: {pullRequestId: pullRequest.id},
  });
  return autoMergeResult(data, 'disablePullRequestAutoMerge');
}

async function readPullRequest(
  graphql: GraphqlClient,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const data = await graphql(GET_PULL_REQUEST_QUERY, {
    owner: args.owner,
    repo: args.repo,
    pullNumber: args.pull_number,
  });
  const pullRequest =
    isRecord(data) && isRecord(data.repository) ? data.repository.pullRequest : undefined;
  if (!isRecord(pullRequest) || typeof pullRequest.id !== 'string') {
    throw malformedResponse();
  }
  return pullRequest;
}

function isImmediatelyMergeable(error: unknown): boolean {
  const errors = githubGraphqlErrors(error) ?? [];
  return errors.some(
    (entry) =>
      typeof entry.message === 'string' && IMMEDIATELY_MERGEABLE_PATTERN.test(entry.message),
  );
}

function autoMergeResult(data: unknown, mutation: string): Record<string, unknown> {
  const payload = isRecord(data) ? data[mutation] : undefined;
  const pullRequest = isRecord(payload) ? payload.pullRequest : undefined;
  if (!isRecord(pullRequest)) throw malformedResponse();
  return autoMergeOutput(pullRequest);
}

function autoMergeOutput(pullRequest: Record<string, unknown>): Record<string, unknown> {
  const autoMerge = pullRequest.autoMergeRequest;
  const mergeCommit = pullRequest.mergeCommit;
  return {
    pull_request: {
      number: pullRequest.number,
      url: pullRequest.url,
      state: String(pullRequest.state).toLowerCase(),
      merged: pullRequest.merged === true,
      merge_commit_oid: isRecord(mergeCommit) ? mergeCommit.oid : null,
    },
    auto_merge: isRecord(autoMerge)
      ? {
          merge_method: String(autoMerge.mergeMethod).toLowerCase(),
          enabled_at: autoMerge.enabledAt ?? null,
        }
      : null,
  };
}

function malformedResponse(): GithubIntegrationProviderError {
  return new GithubIntegrationProviderError(
    'malformed-provider-response',
    'GitHub did not return the pull request',
  );
}

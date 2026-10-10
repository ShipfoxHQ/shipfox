import {mapGithubError} from '#api/client.js';
import type {GithubToolClient} from './agent-tools.js';

const LABELS_ROUTE = 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels';
const ASSIGNEES_ROUTE = 'POST /repos/{owner}/{repo}/issues/{issue_number}/assignees';
const MILESTONE_ROUTE = 'PATCH /repos/{owner}/{repo}/issues/{issue_number}';

export const CONVERT_PULL_REQUEST_TO_DRAFT_MUTATION = `
  mutation ConvertPullRequestToDraft($input: ConvertPullRequestToDraftInput!) {
    convertPullRequestToDraft(input: $input) {
      pullRequest {
        isDraft
      }
    }
  }
`;

export const MARK_PULL_REQUEST_READY_MUTATION = `
  mutation MarkPullRequestReadyForReview($input: MarkPullRequestReadyForReviewInput!) {
    markPullRequestReadyForReview(input: $input) {
      pullRequest {
        isDraft
      }
    }
  }
`;

/** Settings GitHub's pull request endpoints do not take, applied after the pull request is saved. */
export interface PullRequestExtras {
  labels?: string[] | undefined;
  assignees?: string[] | undefined;
  milestone?: number | undefined;
  /** Set only on an update. A new pull request takes `draft` in its create request. */
  draft?: boolean | undefined;
}

const EXTRA_LIST_ARGUMENTS = ['labels', 'assignees', 'add_labels', 'add_assignees'] as const;

export function validatePullRequestExtras(arguments_: Record<string, unknown>): string | undefined {
  for (const name of EXTRA_LIST_ARGUMENTS) {
    const value = arguments_[name];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
      return `Parameter ${name} must be an array of non-empty strings`;
    }
  }
  const milestone = arguments_.milestone;
  if (milestone !== undefined && (!Number.isInteger(milestone) || (milestone as number) < 1)) {
    return 'Parameter milestone must be a positive integer';
  }
  return arguments_.draft !== undefined && typeof arguments_.draft !== 'boolean'
    ? 'Parameter draft must be a boolean'
    : undefined;
}

/** Splits a tool call into the pull request request itself and the settings applied after it. */
export function splitPullRequestExtras(
  toolId: 'create_pull_request' | 'update_pull_request',
  parameters: Record<string, unknown>,
): {request: Record<string, unknown>; extras: PullRequestExtras} {
  const {labels, assignees, milestone, add_labels, add_assignees, ...request} = parameters;
  if (toolId === 'create_pull_request') {
    return {
      request,
      extras: {
        labels: stringList(labels),
        assignees: stringList(assignees),
        milestone: typeof milestone === 'number' ? milestone : undefined,
      },
    };
  }
  const {draft, ...update} = request;
  return {
    request: update,
    extras: {
      labels: stringList(add_labels),
      assignees: stringList(add_assignees),
      milestone: typeof milestone === 'number' ? milestone : undefined,
      draft: typeof draft === 'boolean' ? draft : undefined,
    },
  };
}

/**
 * Applies each setting on its own and returns one warning per failure. The pull request already
 * exists at this point, so a failure here must not fail the call: a retry would open a duplicate.
 */
export async function applyPullRequestExtras(
  client: GithubToolClient,
  params: {
    owner: unknown;
    repo: unknown;
    pullNumber: number;
    pullRequest: Record<string, unknown>;
    extras: PullRequestExtras;
  },
): Promise<{warnings: string[]; draft: boolean | undefined}> {
  const {extras, pullRequest} = params;
  const issue = {owner: params.owner, repo: params.repo, issue_number: params.pullNumber};
  const warnings: string[] = [];
  const attempt = async (subject: string, operation: () => Promise<unknown>): Promise<boolean> => {
    try {
      await mapGithubError(operation, 'provider-rejected');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(
        `Pull request #${params.pullNumber} was saved but ${subject} failed: ${message}`,
      );
      return false;
    }
  };

  if (extras.labels !== undefined && extras.labels.length > 0) {
    const labels = extras.labels;
    await attempt('adding labels', () => client.request(LABELS_ROUTE, {...issue, labels}));
  }
  if (extras.assignees !== undefined && extras.assignees.length > 0) {
    const assignees = extras.assignees;
    await attempt('adding assignees', () => client.request(ASSIGNEES_ROUTE, {...issue, assignees}));
  }
  if (extras.milestone !== undefined) {
    const milestone = extras.milestone;
    await attempt('setting the milestone', () =>
      client.request(MILESTONE_ROUTE, {...issue, milestone}),
    );
  }

  let draft: boolean | undefined;
  if (extras.draft !== undefined && pullRequest.draft !== extras.draft) {
    const target = extras.draft;
    const changed = await attempt(
      target ? 'converting it to a draft' : 'marking it ready for review',
      () => setDraft(client, pullRequest.node_id, target),
    );
    if (changed) draft = target;
  }
  return {warnings, draft};
}

async function setDraft(client: GithubToolClient, nodeId: unknown, draft: boolean): Promise<void> {
  if (client.graphql === undefined || typeof nodeId !== 'string') {
    throw new Error('GitHub did not return the pull request node id');
  }
  await client.graphql(
    draft ? CONVERT_PULL_REQUEST_TO_DRAFT_MUTATION : MARK_PULL_REQUEST_READY_MUTATION,
    {input: {pullRequestId: nodeId}},
  );
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

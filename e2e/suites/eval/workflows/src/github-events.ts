import type {GithubWebhookSender} from '@shipfox/e2e-driver-github';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {z} from 'zod';
import {formatValidationIssues} from './schema.js';
import type {EventSender, EventSenderContext} from './senders.js';

const MAX_DELIVERY_ATTEMPTS = 6;
const RUN_LOOKUP_TIMEOUT_MS = 5_000;

// `$pr` resolves to the whole pull request reference. Only its number picks the pull request.
const pullRequestSchema = z.object({number: z.number().int().positive()}).passthrough();

const reviewCommentSchema = z
  .object({
    pull_request: pullRequestSchema,
    body: z.string().min(1),
    author: z.string().min(1).optional(),
    author_association: z
      .enum(['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE'])
      .optional(),
    author_type: z.enum(['User', 'Bot']).optional(),
    path: z.string().min(1).optional(),
  })
  .strict();

const pullRequestClosedSchema = z
  .object({pull_request: pullRequestSchema, merged: z.boolean().optional()})
  .strict();

const workflowRunCompletedSchema = z
  .object({
    pull_request: pullRequestSchema.optional(),
    conclusion: z
      .enum([
        'success',
        'failure',
        'cancelled',
        'timed_out',
        'skipped',
        'neutral',
        'action_required',
        'stale',
      ])
      .optional(),
    actor: z.string().min(1).optional(),
    head_commit_message: z.string().optional(),
    run_attempt: z.number().int().positive().optional(),
  })
  .strict();

const issueLabeledSchema = z
  .object({
    issue: z.number().int().positive(),
    label: z.string().min(1),
    sender: z.string().min(1).optional(),
  })
  .strict();

function parsePayload<T>({
  schema,
  event,
  payload,
}: {
  schema: z.ZodType<T>;
  event: string;
  payload: unknown;
}): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `The github ${event} payload is invalid:\n${formatValidationIssues(result.error)}`,
    );
  }
  return result.data;
}

/**
 * A delivery that lands before the definition's subscription is active starts no run. So the
 * sender delivers again, with a new delivery, until one starts a run. It returns the delivery that
 * did.
 */
async function deliverUntilRun({
  deliver,
  context,
  signal,
  waitForRun,
}: {
  deliver: () => Promise<{deliveryId: string}>;
  context: EventSenderContext;
  signal?: AbortSignal | undefined;
  waitForRun: typeof waitForRunByDeliveryId;
}): Promise<{deliveryId: string}> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS && !signal?.aborted; attempt += 1) {
    const {deliveryId} = await deliver();
    try {
      await waitForRun({
        deliveryId,
        projectId: context.projectId,
        workspaceId: context.workspaceId,
        token: context.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        ...(signal === undefined ? {} : {signal}),
      });
      return {deliveryId};
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('No run started from the signed GitHub deliveries.', {cause: lastError});
}

/**
 * Delivers a scenario's GitHub events through the case's GitHub fake, which updates its pull
 * request state and signs the webhook the way GitHub does. A `workflow_run.completed` event
 * belongs to the case repository. Its head is the named pull request's, or else the default branch.
 */
export function createGithubEventSender(
  github: GithubWebhookSender,
  {waitForRun = waitForRunByDeliveryId}: {waitForRun?: typeof waitForRunByDeliveryId} = {},
): EventSender {
  return async ({event, payload, context, signal}) => {
    switch (event) {
      case 'pull_request_review_comment.created': {
        const comment = parsePayload({schema: reviewCommentSchema, event, payload});
        return await github.sendPullRequestReviewComment({
          pullNumber: comment.pull_request.number,
          body: comment.body,
          author: comment.author,
          authorAssociation: comment.author_association,
          authorType: comment.author_type,
          path: comment.path,
        });
      }
      case 'pull_request.closed': {
        const closed = parsePayload({schema: pullRequestClosedSchema, event, payload});
        return await github.sendPullRequestClosed({
          pullNumber: closed.pull_request.number,
          merged: closed.merged,
        });
      }
      case 'workflow_run.completed': {
        const run = parsePayload({schema: workflowRunCompletedSchema, event, payload});
        return await github.sendWorkflowRunCompleted({
          repository: context.repository,
          pullNumbers: run.pull_request === undefined ? undefined : [run.pull_request.number],
          conclusion: run.conclusion,
          actor: run.actor,
          headCommitMessage: run.head_commit_message,
          runAttempt: run.run_attempt,
        });
      }
      case 'issues.labeled': {
        // An issue label event is expected to start a run, because the template's issue trigger is
        // the only subscriber a case defines.
        const labeled = parsePayload({schema: issueLabeledSchema, event, payload});
        return await deliverUntilRun({
          context,
          signal,
          waitForRun,
          deliver: async () =>
            await github.sendIssueLabeled({
              issueNumber: labeled.issue,
              label: labeled.label,
              sender: labeled.sender,
            }),
        });
      }
      default:
        throw new Error(`The GitHub fake cannot send ${event} events.`);
    }
  };
}

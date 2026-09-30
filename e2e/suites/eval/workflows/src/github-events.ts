import type {GithubWebhookSender} from '@shipfox/e2e-driver-github';
import {z} from 'zod';
import {formatValidationIssues} from './schema.js';
import type {EventSender} from './senders.js';

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
 * Delivers a scenario's GitHub events through the case's GitHub fake, which updates its pull
 * request state and signs the webhook the way GitHub does.
 */
export function createGithubEventSender(github: GithubWebhookSender): EventSender {
  return async ({event, payload}) => {
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
      default:
        throw new Error(`The GitHub fake cannot send ${event} events.`);
    }
  };
}

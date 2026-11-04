import type {ConversationRunResultDto} from '@shipfox/api-agent-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {newConversationRecordId} from '#db/conversations.js';
import {
  clearRunLinkCheck,
  listRunLinkChecks,
  listRunsWithStaleChecks,
  queueRunResult,
  type RunLinkCheck,
} from '#db/run-links.js';
import {CONVERSATION_SESSION_VERSION} from './conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  sealConversationEntry,
} from './conversation-sealing.js';
import {RUN_RESULT_CUSTOM_TYPE} from './entities/conversation.js';
import {TOOL_RESULT_MAX_BYTES, wrapUntrustedText} from './turn-runtime/tool-result.js';

/** How long a requested check waits before the sweep runs it. Events run it at once. */
export const RUN_CHECK_STALE_AFTER_MS = 60_000;

/** Runs one sweep checks. A larger backlog drains over the next firings. */
export const RUN_CHECK_BATCH_LIMIT = 100;

export type RunDeliveryWorkflows = Pick<WorkflowsModuleClient, 'getWorkflowRunOverview'>;

type RunOverview = NonNullable<Awaited<ReturnType<RunDeliveryWorkflows['getWorkflowRunOverview']>>>;

const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'skipped']);
const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

export type RunDelivery =
  | {kind: 'ended'; status: string}
  | {kind: 'settled'; status: 'settled'}
  | undefined;

/**
 * Whether a run attempt has a result to deliver. An ended attempt does. A settled one does too:
 * it isn't terminal, every one-shot job is, and a listener holds the run open. The attempt ends
 * in one transaction, so a cancel or a timeout never shows these facts mid-way. A large run has
 * no job modes in its overview, so it delivers only when it ends.
 */
export function readRunDelivery(overview: RunOverview): RunDelivery {
  const {status} = overview.attempt;
  if (TERMINAL_RUN_STATUSES.has(status)) return {kind: 'ended', status};
  if (overview.jobs.kind !== 'complete') return undefined;

  const {items} = overview.jobs;
  const oneShotDone = items
    .filter((job) => job.mode === 'one_shot')
    .every((job) => TERMINAL_JOB_STATUSES.has(job.status));
  const listening = items.some((job) => job.listener_status === 'listening');
  return oneShotDone && listening ? {kind: 'settled', status: 'settled'} : undefined;
}

function finishedJobKeys(overview: RunOverview): string[] {
  const items =
    overview.jobs.kind === 'complete' ? overview.jobs.items : overview.jobs.first_page.items;
  return items.filter((job) => TERMINAL_JOB_STATUSES.has(job.status)).map((job) => job.key);
}

/**
 * The `run_result` entry. The text is what the model reads, and the run's name, outputs, and
 * failure message come from workflow authors, so they are wrapped as untrusted data when written.
 * `details` is what the client shows.
 */
export function runResultEntry(params: {
  overview: RunOverview;
  delivery: NonNullable<RunDelivery>;
}): string {
  const {overview, delivery} = params;
  const {attempt, run} = overview;
  const outputs =
    delivery.kind === 'ended' && delivery.status === 'succeeded' ? attempt.outputs : null;
  const details: ConversationRunResultDto = {
    workflow_run_id: run.id,
    run_attempt_id: attempt.id,
    status: delivery.status,
    job_keys: finishedJobKeys(overview),
    outputs,
  };
  const data = wrapUntrustedText({
    source: `run:${run.id}`,
    text: JSON.stringify({
      run_id: run.id,
      run_number: run.number,
      name: run.name,
      attempt: attempt.attempt,
      status: delivery.status,
      status_reason: attempt.status_reason,
      status_reason_message: attempt.status_reason_message,
      finished_jobs: details.job_keys,
      outputs,
    }),
    maxBytes: TOOL_RESULT_MAX_BYTES,
  });
  const lead =
    delivery.kind === 'settled'
      ? 'A workflow run you started has settled: its one-shot jobs finished and a listener keeps the run open.'
      : `A workflow run you started has ended with status ${delivery.status}.`;
  return JSON.stringify({
    type: 'custom_message',
    customType: RUN_RESULT_CUSTOM_TYPE,
    content: `${lead}\n${data}`,
    display: true,
    details,
    timestamp: new Date().toISOString(),
  });
}

async function deliverToConversation(params: {
  check: RunLinkCheck;
  workflowRunId: string;
  overview: RunOverview;
  delivery: NonNullable<RunDelivery>;
}): Promise<boolean> {
  const {check, workflowRunId, overview, delivery} = params;
  const id = await newConversationRecordId();
  const sealedEntry = sealConversationEntry({
    key: await conversationDataKey(check.workspaceId),
    aad: aadForConversationItem({
      workspaceId: check.workspaceId,
      conversationId: check.conversationId,
      itemId: id,
    }),
    entry: runResultEntry({overview, delivery}),
  });
  return await queueRunResult({
    conversationId: check.conversationId,
    workflowRunId,
    checkRequestedAt: check.checkRequestedAt,
    entry: {
      id,
      runAttemptId: overview.attempt.id,
      sessionVersion: CONVERSATION_SESSION_VERSION,
      sealedEntry,
      meta: {custom_type: RUN_RESULT_CUSTOM_TYPE},
    },
  });
}

/**
 * Delivers the result of a run to every conversation that started it and has a check requested.
 * The overview is read before any transaction, because a transaction doesn't cross owners.
 * A result queues as an input and wakes the conversation. A check clears only when the run had
 * nothing to deliver yet, no longer exists, or delivered, and only if no newer event asked again.
 * A failure leaves the check requested, so the sweep runs it again.
 */
export async function deliverRunResults(params: {
  workflowRunId: string;
  workflows: RunDeliveryWorkflows;
  wake: (conversationId: string) => Promise<void>;
}): Promise<{delivered: number}> {
  const {workflowRunId, workflows} = params;
  const checks = await listRunLinkChecks(workflowRunId);
  const overviews = new Map<string, Promise<RunOverview | null>>();
  let delivered = 0;

  for (const check of checks) {
    let pending = overviews.get(check.workspaceId);
    if (!pending) {
      pending = workflows.getWorkflowRunOverview({workspaceId: check.workspaceId, workflowRunId});
      overviews.set(check.workspaceId, pending);
    }
    const overview = await pending;
    const delivery = overview === null ? undefined : readRunDelivery(overview);

    if (overview === null || delivery === undefined) {
      await clearRunLinkCheck({
        conversationId: check.conversationId,
        workflowRunId,
        checkRequestedAt: check.checkRequestedAt,
      });
      continue;
    }

    try {
      if (await deliverToConversation({check, workflowRunId, overview, delivery})) {
        delivered += 1;
        await params.wake(check.conversationId);
      }
    } catch (error) {
      logger().warn(
        {err: error, conversationId: check.conversationId, workflowRunId},
        'Failed to deliver a run result to a conversation',
      );
    }
  }
  return {delivered};
}

/**
 * Runs the checks that events left requested for over a minute: a delivery that failed, or an
 * event handled by a process that then went down. One run failing doesn't stop the others.
 */
export async function recoverRunResultDeliveries(params: {
  workflows: RunDeliveryWorkflows;
  wake: (conversationId: string) => Promise<void>;
  limit?: number | undefined;
}): Promise<{checked: number}> {
  const workflowRunIds = await listRunsWithStaleChecks({
    olderThanMs: RUN_CHECK_STALE_AFTER_MS,
    limit: params.limit ?? RUN_CHECK_BATCH_LIMIT,
  });
  for (const workflowRunId of workflowRunIds) {
    try {
      await deliverRunResults({workflowRunId, workflows: params.workflows, wake: params.wake});
    } catch (error) {
      logger().warn({err: error, workflowRunId}, 'Failed to check a run for delivery');
    }
  }
  return {checked: workflowRunIds.length};
}

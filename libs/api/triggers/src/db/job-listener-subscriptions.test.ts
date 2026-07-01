import type {WorkflowsJobActivatedEventDto} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {jobListenerSubscriptions} from '#db/schema/job-listener-subscriptions.js';
import {onJobActivated} from '#presentation/subscribers/on-job-activated.js';
import {onJobTerminated} from '#presentation/subscribers/on-job-terminated.js';
import {jobListenerSubscriptionFactory} from '#test/index.js';
import {findMatchingJobListenerSubscriptions} from './job-listener-subscriptions.js';

function buildActivatedPayload(
  overrides: Partial<WorkflowsJobActivatedEventDto> = {},
): WorkflowsJobActivatedEventDto {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    mode: 'listening',
    on: [{source: 'github', event: 'pull_request_review', inputs: {state: 'approved'}}],
    until: [{source: 'github', event: 'pull_request', filter: 'payload.action == "closed"'}],
    ...overrides,
  };
}

function listJobSubscriptions(jobId: string) {
  return db()
    .select()
    .from(jobListenerSubscriptions)
    .where(eq(jobListenerSubscriptions.jobId, jobId));
}

describe('job listener subscriptions', () => {
  it('projects one row per activated listener matcher with its ordinal', async () => {
    const payload = buildActivatedPayload({
      on: [
        {source: 'github', event: 'pull_request_review', inputs: {state: 'approved'}},
        {source: 'github', event: 'check_suite'},
      ],
      until: [{source: 'github', event: 'pull_request'}],
    });

    await onJobActivated(payload);

    const rows = await listJobSubscriptions(payload.jobId);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => [row.kind, row.matcherOrdinal]).sort()).toEqual([
      ['on', 0],
      ['on', 1],
      ['until', 0],
    ]);
    expect(rows.find((row) => row.matcherOrdinal === 0 && row.kind === 'on')?.config).toEqual({
      inputs: {state: 'approved'},
    });
  });

  it('does not project subscriptions for one-shot jobs', async () => {
    const payload = buildActivatedPayload({mode: 'one_shot'});

    await onJobActivated(payload);

    const rows = await listJobSubscriptions(payload.jobId);
    expect(rows).toHaveLength(0);
  });

  it('is idempotent for the same activated listener payload', async () => {
    const payload = buildActivatedPayload();

    await onJobActivated(payload);
    await onJobActivated(payload);

    const rows = await listJobSubscriptions(payload.jobId);
    expect(rows).toHaveLength(2);
  });

  it('preserves duplicate source and event matchers by ordinal', async () => {
    const payload = buildActivatedPayload({
      on: [
        {
          source: 'github',
          event: 'pull_request_review',
          filter: 'payload.review.state == "approved"',
        },
        {
          source: 'github',
          event: 'pull_request_review',
          filter: 'payload.review.state == "changes_requested"',
        },
      ],
      until: null,
    });

    await onJobActivated(payload);

    const rows = await listJobSubscriptions(payload.jobId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.matcherOrdinal).sort()).toEqual([0, 1]);
    expect(
      rows.every((row) => row.source === 'github' && row.event === 'pull_request_review'),
    ).toBe(true);
  });

  it('deletes all subscriptions for a terminated job', async () => {
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({jobId, kind: 'on', matcherOrdinal: 0});
    await jobListenerSubscriptionFactory.create({jobId, kind: 'until', matcherOrdinal: 0});

    await onJobTerminated({
      jobId,
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      status: 'succeeded',
      statusReason: null,
    });

    const rows = await listJobSubscriptions(jobId);
    expect(rows).toHaveLength(0);
  });

  it('treats deleting subscriptions for an unknown job as a no-op', async () => {
    const jobId = crypto.randomUUID();

    await onJobTerminated({
      jobId,
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      status: 'cancelled',
      statusReason: null,
    });

    const rows = await listJobSubscriptions(jobId);
    expect(rows).toHaveLength(0);
  });

  it('finds matching subscriptions by workspace, source, and event', async () => {
    const workspaceId = crypto.randomUUID();
    const matching = await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    await jobListenerSubscriptionFactory.create({
      workspaceId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
    });
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request',
    });

    const rows = await findMatchingJobListenerSubscriptions({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    expect(rows.map((row) => row.id)).toEqual([matching.id]);
  });

  it('returns no subscriptions for a negative match', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    const rows = await findMatchingJobListenerSubscriptions({
      workspaceId,
      source: 'github',
      event: 'pull_request',
    });

    expect(rows).toHaveLength(0);
  });
});

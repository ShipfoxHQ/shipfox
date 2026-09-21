import {createDevRunResponseSchema} from '@shipfox/api-triggers-dto';
import {workflowRunResponseSchema} from '@shipfox/api-workflows-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {observeRun} from '@shipfox/e2e-observe-workflows';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createInvitation} from '@shipfox/e2e-setup-workspaces';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const RUN_STATE_TIMEOUT_MS = 60_000;

const QUEUED_WORKFLOW = `
name: Pull request queue
runner: __RUNNER_LABEL__
concurrency:
  group: 'pull-request-\${{ inputs.pull_request_number }}'
  scope: project
  cancel_in_progress: false
triggers:
  manual:
    source: manual
jobs:
  hold:
    steps:
      - run: echo queued
`;

const CANCELLING_WORKFLOW = `
name: Pull request cancellation
runner: __RUNNER_LABEL__
concurrency:
  group: 'pull-request-\${{ inputs.pull_request_number }}'
  scope: project
  cancel_in_progress: true
triggers:
  manual:
    source: manual
jobs:
  hold:
    steps:
      - run: echo cancelling
`;

test('applies latest-wins replacement, cancellation policy, manual input, and rerun impact', async ({
  suite,
}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const repo = `workflow-concurrency-${uniqueId}`;
  const runnerLabel = `e2e-workflow-concurrency-${uniqueId}`;
  const token = suite.sessionToken;
  const client = createApiClient({token});
  const activeRunIds = new Set<string>();

  try {
    const {definition, additionalDefinitions} = await seedProjectWithApiDefinition({
      suite,
      token,
      name: 'workflow-concurrency',
      repo,
      runnerLabel,
      workflowYaml: QUEUED_WORKFLOW,
      configPath: '.shipfox/workflows/pull-request-queue.yml',
      additionalDefinitions: [
        {
          configPath: '.shipfox/workflows/pull-request-cancellation.yml',
          workflowYaml: CANCELLING_WORKFLOW,
        },
      ],
    });
    const cancellingDefinition = additionalDefinitions[0];
    if (!cancellingDefinition) throw new Error('Expected the cancelling workflow definition');
    const inputs = {pull_request_number: 42};

    const holderId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs,
      scenario: `${repo}-holder`,
    });
    activeRunIds.add(holderId);
    await waitForConcurrency({runId: holderId, token, state: 'acquired'});

    const firstWaiterId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs,
      scenario: `${repo}-first-waiter`,
    });
    activeRunIds.add(firstWaiterId);
    await waitForConcurrency({runId: firstWaiterId, token, status: 'waiting', state: 'waiting'});

    const latestWaiterId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs,
      scenario: `${repo}-latest-waiter`,
    });
    activeRunIds.add(latestWaiterId);
    const latestWaiter = await waitForConcurrency({
      runId: latestWaiterId,
      token,
      status: 'waiting',
      state: 'waiting',
    });
    const supersededFirstWaiter = await waitForConcurrency({
      runId: firstWaiterId,
      token,
      status: 'cancelled',
      state: 'superseded',
    });
    const holderAfterQueuedWaiters = await waitForConcurrency({
      runId: holderId,
      token,
      state: 'acquired',
    });

    expect(latestWaiter.attempt.concurrency).toMatchObject({
      display_group: 'pull-request-42',
      scope: 'project',
      policy: {cancel_in_progress: false},
    });
    expect(supersededFirstWaiter.attempt.concurrency?.affected_attempts).toEqual([
      expect.objectContaining({workflow_run_id: latestWaiterId}),
    ]);
    expect(holderAfterQueuedWaiters.status).not.toBe('cancelled');

    const cancellingRunId = await fireManualAndAwaitRun({
      client,
      definitionId: cancellingDefinition.id,
      inputs,
      scenario: `${repo}-cancelling`,
    });
    activeRunIds.add(cancellingRunId);
    const cancelledHolder = await waitForConcurrency({
      runId: holderId,
      token,
      status: 'cancelled',
      state: 'released',
    });
    const cancelledLatestWaiter = await waitForConcurrency({
      runId: latestWaiterId,
      token,
      status: 'cancelled',
      state: 'superseded',
    });
    const newHolder = await waitForConcurrency({
      runId: cancellingRunId,
      token,
      state: 'acquired',
    });

    expect(cancelledHolder.status).toBe('cancelled');
    expect(cancelledLatestWaiter.status).toBe('cancelled');
    expect(newHolder.attempt.concurrency).toMatchObject({
      display_group: 'pull-request-42',
      policy: {cancel_in_progress: true},
    });

    const newerWaiterId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs,
      scenario: `${repo}-newer-waiter`,
    });
    activeRunIds.add(newerWaiterId);
    await waitForConcurrency({runId: newerWaiterId, token, status: 'waiting', state: 'waiting'});

    workflowRunResponseSchema.parse(
      await client.requestJson(
        'post',
        `/workflows/runs/${encodeURIComponent(firstWaiterId)}/rerun`,
        {json: {mode: 'all'}},
      ),
    );
    const rerunWaiter = await waitForConcurrency({
      runId: firstWaiterId,
      token,
      attempt: 2,
      status: 'waiting',
      state: 'waiting',
    });
    const waiterSupersededByRerun = await waitForConcurrency({
      runId: newerWaiterId,
      token,
      status: 'cancelled',
      state: 'superseded',
    });
    const holderAfterRerun = await waitForConcurrency({
      runId: cancellingRunId,
      token,
      state: 'acquired',
    });

    expect(rerunWaiter).toMatchObject({current_attempt: 2, latest_attempt: 2});
    expect(rerunWaiter.attempt.concurrency).toMatchObject({
      display_group: 'pull-request-42',
      policy: {cancel_in_progress: false},
    });
    expect(waiterSupersededByRerun.attempt.concurrency?.affected_attempts).toEqual([
      expect.objectContaining({workflow_run_id: firstWaiterId}),
    ]);
    expect(holderAfterRerun.status).not.toBe('cancelled');
  } finally {
    for (const runId of [...activeRunIds].reverse()) await cancelRun(client, runId);
  }
});

test('isolates development concurrency groups by initiating user', async ({suite}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const repo = `dev-concurrency-${uniqueId}`;
  const runnerLabel = `e2e-dev-concurrency-${uniqueId}`;
  const configPath = `.shipfox/workflows/${repo}.yml`;
  const workflowYaml = `
name: Development concurrency isolation
runner: ${runnerLabel}
concurrency:
  group: 'pull-request-\${{ inputs.pull_request_number }}'
  cancel_in_progress: true
triggers:
  manual:
    source: manual
jobs:
  hold:
    steps:
      - run: echo development
`;
  const ownerClient = createApiClient({token: suite.sessionToken});
  const activeRuns: Array<{client: ReturnType<typeof createApiClient>; runId: string}> = [];

  try {
    const {project} = await seedProjectWithApiDefinition({
      suite,
      token: suite.sessionToken,
      name: 'dev-concurrency',
      repo,
      runnerLabel,
      workflowYaml,
      configPath,
      repositoryBacked: true,
    });
    const member = await createUser();
    const invitation = await createInvitation({
      workspaceId: suite.workspaceId,
      email: member.email,
      invitedByUserId: suite.userId,
    });
    const acceptanceSession = await createSession({user_id: member.user.id});
    await createApiClient({token: acceptanceSession.token}).requestJson(
      'post',
      '/invitations/accept',
      {json: {token: invitation.raw_token}},
    );
    const memberSession = await createSession({user_id: member.user.id});
    const memberClient = createApiClient({token: memberSession.token});
    const devRunBody = {
      project_id: project.id,
      ref: 'refs/heads/main',
      content: workflowYaml,
      config_path: configPath,
      trigger: 'manual',
      inputs: {pull_request_number: 73},
    };

    const ownerRun = createDevRunResponseSchema.parse(
      await ownerClient.requestJson('post', '/dev-runs', {json: devRunBody}),
    );
    activeRuns.push({client: ownerClient, runId: ownerRun.workflow_run_id});
    const ownerObservation = await waitForConcurrency({
      runId: ownerRun.workflow_run_id,
      token: suite.sessionToken,
      state: 'acquired',
    });

    const memberRun = createDevRunResponseSchema.parse(
      await memberClient.requestJson('post', '/dev-runs', {json: devRunBody}),
    );
    activeRuns.push({client: memberClient, runId: memberRun.workflow_run_id});
    const memberObservation = await waitForConcurrency({
      runId: memberRun.workflow_run_id,
      token: memberSession.token,
      state: 'acquired',
    });
    const ownerAfterMemberRun = await waitForConcurrency({
      runId: ownerRun.workflow_run_id,
      token: suite.sessionToken,
      state: 'acquired',
    });

    expect(ownerObservation).toMatchObject({
      origin: 'dev',
      dev_source: {initiated_by_user_id: suite.userId},
    });
    expect(memberObservation).toMatchObject({
      origin: 'dev',
      dev_source: {initiated_by_user_id: member.user.id},
    });
    expect(ownerAfterMemberRun.status).not.toBe('cancelled');
    expect(ownerObservation.attempt.concurrency).toMatchObject({
      display_group: 'pull-request-73',
      state: 'acquired',
    });
    expect(memberObservation.attempt.concurrency).toMatchObject({
      display_group: 'pull-request-73',
      state: 'acquired',
    });
  } finally {
    for (const {client, runId} of activeRuns.reverse()) await cancelRun(client, runId);
  }
});

async function waitForConcurrency(params: {
  runId: string;
  token: string;
  state: 'acquired' | 'waiting' | 'superseded' | 'released';
  status?: WorkflowRunObservation['status'];
  attempt?: number;
}): Promise<WorkflowRunObservation> {
  let last: WorkflowRunObservation | undefined;
  return await pollUntil(
    {
      timeoutMs: RUN_STATE_TIMEOUT_MS,
      intervalMs: 100,
      maxIntervalMs: 1_000,
      backoffFactor: 1.5,
      describe: () =>
        `workflow concurrency state: runId=${params.runId} expected=${params.status ?? '*'}:${params.state} observed=${last?.status ?? 'none'}:${last?.attempt.concurrency?.state ?? 'none'} attempt=${last?.current_attempt ?? 'none'}`,
    },
    async () => {
      last = await observeRun({runId: params.runId, token: params.token});
      const statusMatches = params.status === undefined || last.status === params.status;
      const attemptMatches =
        params.attempt === undefined || last.current_attempt === params.attempt;
      return statusMatches && attemptMatches && last.attempt.concurrency?.state === params.state
        ? last
        : null;
    },
  );
}

async function cancelRun(client: ReturnType<typeof createApiClient>, runId: string): Promise<void> {
  await client
    .request('post', `/workflows/runs/${encodeURIComponent(runId)}/cancel`)
    .then(() => undefined)
    .catch(() => undefined);
}

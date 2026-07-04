import {createApiClient} from '@shipfox/e2e-core';
import {fetchStepLogs} from '@shipfox/e2e-helper-logs';
import {type LocalRunnerHandle, stopLocalRunner} from '@shipfox/e2e-helper-runners';
import type {waitForRunTerminal} from '@shipfox/e2e-helper-workflows';
import {
  type AttachFn,
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {logText} from '#expect.js';
import {
  batchedListenerExecutionMatches,
  findListenerExecutionBySequence,
  sendWebhookDeliveryUntilObserved,
  waitForListenerExecution,
  waitForListenerResolution,
} from '#listener-helpers.js';
import {waitForRunDetailMatching} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {
  attachWebhookTriggerDiagnostics,
  createWebhookConnection,
  postWebhookDelivery,
  type WebhookDiagnosticsRequest,
} from '#webhook.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const LISTENER_JOB = 'listen';
const FIRE_SOURCE_PLACEHOLDER = '__FIRE_WEBHOOK_SOURCE__';
const RESOLVE_SOURCE_PLACEHOLDER = '__RESOLVE_WEBHOOK_SOURCE__';

interface ListenerCase {
  attach: AttachFn;
  client: ReturnType<typeof createApiClient>;
  fireConnection: Awaited<ReturnType<typeof createWebhookConnection>>;
  fireDiagnostics: WebhookDiagnosticsRequest;
  resolveConnection: Awaited<ReturnType<typeof createWebhookConnection>>;
  resolveDiagnostics: WebhookDiagnosticsRequest;
  repo: string;
  runner: LocalRunnerHandle;
  runnerLogFile: string;
  runnerLabel: string;
  token: string;
  uniqueId: string;
  workspaceId: string;
}

async function attachRunDetail(params: {
  attach: AttachFn;
  runId: string | undefined;
  token: string;
}): Promise<void> {
  if (params.runId === undefined) return;
  try {
    const client = createApiClient({token: params.token});
    const runDetail = await client.requestJson<Awaited<ReturnType<typeof waitForRunTerminal>>>(
      'get',
      `/workflows/runs/${encodeURIComponent(params.runId)}`,
    );
    await params.attach({
      name: 'run-detail.json',
      contentType: 'application/json',
      body: JSON.stringify(runDetail, null, 2),
    });
    for (const request of collectStepLogAttachmentRequests(runDetail)) {
      await params.attach(await fetchLogAttachment(request, params.token));
    }
  } catch (error) {
    await params.attach({
      name: 'run-detail.error.txt',
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    });
  }
}

async function setupListenerCase(params: {
  suite: SuiteContext;
  testName: string;
  workflowYaml: string;
  attach: AttachFn;
}): Promise<ListenerCase & {definitionId: string}> {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-listener-${params.testName}-${uniqueId}`;
  const repo = `listener-${params.testName}-${uniqueId}`;
  const fireSlug = `listener-fire-${params.testName}-${uniqueId}`;
  const resolveSlug = `listener-resolve-${params.testName}-${uniqueId}`;

  const [fireConnection, resolveConnection] = await Promise.all([
    createWebhookConnection({
      client,
      scenario: params.testName,
      slug: fireSlug,
      uniqueId,
      workspaceId: params.suite.workspaceId,
    }),
    createWebhookConnection({
      client,
      scenario: params.testName,
      slug: resolveSlug,
      uniqueId,
      workspaceId: params.suite.workspaceId,
    }),
  ]);

  const {definition} = await seedAndWaitForDefinition({
    suite: params.suite,
    token,
    name: params.testName,
    repo,
    runnerLabel,
    workflowYaml: params.workflowYaml,
    configPath: `.shipfox/workflows/${params.testName}.yml`,
    replacements: {
      [FIRE_SOURCE_PLACEHOLDER]: fireSlug,
      [RESOLVE_SOURCE_PLACEHOLDER]: resolveSlug,
    },
  });

  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E listener ${params.testName} ${uniqueId}`,
    runnerLabel,
  });

  return {
    attach: params.attach,
    client,
    definitionId: definition.id,
    fireConnection,
    fireDiagnostics: {deliveryIds: [], source: fireSlug},
    repo,
    resolveConnection,
    resolveDiagnostics: {deliveryIds: [], source: resolveSlug},
    runner: localRunner.runner,
    runnerLabel,
    runnerLogFile: localRunner.logFile,
    token,
    uniqueId,
    workspaceId: params.suite.workspaceId,
  };
}

async function cleanupListenerCase(testCase: ListenerCase | undefined, runId: string | undefined) {
  if (testCase === undefined) return;
  await attachRunDetail({attach: testCase.attach, runId, token: testCase.token});
  await attachWebhookTriggerDiagnostics({
    attach: testCase.attach,
    client: testCase.client,
    deliveryIds: testCase.fireDiagnostics.deliveryIds,
    source: testCase.fireDiagnostics.source,
    workspaceId: testCase.workspaceId,
  }).catch(() => undefined);
  await attachWebhookTriggerDiagnostics({
    attach: testCase.attach,
    client: testCase.client,
    deliveryIds: testCase.resolveDiagnostics.deliveryIds,
    source: testCase.resolveDiagnostics.source,
    workspaceId: testCase.workspaceId,
  }).catch(() => undefined);
  await attachLocalRunnerLog(testCase.attach, testCase.runnerLogFile);
}

async function stopRunner(testCase: ListenerCase | undefined): Promise<void> {
  if (testCase === undefined) return;
  await stopLocalRunner(testCase.runner).catch((error: unknown) => {
    process.stderr.write(`listener-jobs-e2e: stopLocalRunner failed: ${String(error)}\n`);
  });
}

async function fireManualRun(testCase: ListenerCase & {definitionId: string}) {
  return await fireManualAndAwaitRun({
    client: testCase.client,
    definitionId: testCase.definitionId,
    inputs: {},
    scenario: testCase.repo,
  });
}

async function sendFire(testCase: ListenerCase, runId: string, label: string, message: string) {
  const result = await sendWebhookDeliveryUntilObserved({
    client: testCase.client,
    connection: testCase.fireConnection,
    runId,
    token: testCase.token,
    jobKey: LISTENER_JOB,
    deliveryIdPrefix: `${testCase.uniqueId}-${label}`,
    body: (_attempt, deliveryId) => ({message, delivery_id: deliveryId}),
  });
  testCase.fireDiagnostics.deliveryIds.push(...result.deliveryIds);
  return result;
}

async function sendResolve(testCase: ListenerCase, label: string) {
  const deliveryId = `${testCase.uniqueId}-${label}`;
  testCase.resolveDiagnostics.deliveryIds.push(deliveryId);
  await postWebhookDelivery({
    client: testCase.client,
    connection: testCase.resolveConnection,
    deliveryId,
    webhook: {body: {message: 'resolve', delivery_id: deliveryId}},
  });
  return deliveryId;
}

async function stepLogText(params: {
  runDetail: Awaited<ReturnType<typeof waitForRunTerminal>>;
  token: string;
  jobKey: string;
  sequence: number;
  stepKey: string;
}): Promise<string> {
  const execution = findListenerExecutionBySequence({
    runDetail: params.runDetail,
    jobKey: params.jobKey,
    sequence: params.sequence,
  });
  const step = execution?.steps.find((candidate) => candidate.key === params.stepKey);
  if (!step) throw new Error(`Step ${params.jobKey}.${params.sequence}.${params.stepKey} missing`);
  const logs = await fetchStepLogs({
    stepId: step.id,
    attempt: step.current_attempt,
    token: params.token,
  });
  return logText(logs.records);
}

async function sendBatchPairUntilObserved(params: {
  testCase: ListenerCase;
  runId: string;
  label: string;
}): Promise<{deliveryIds: string[]; runDetail: Awaited<ReturnType<typeof waitForRunTerminal>>}> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const deliveryIds = [
      `${params.testCase.uniqueId}-${params.label}-${attempt}-a`,
      `${params.testCase.uniqueId}-${params.label}-${attempt}-b`,
    ];
    for (const deliveryId of deliveryIds) {
      params.testCase.fireDiagnostics.deliveryIds.push(deliveryId);
      await postWebhookDelivery({
        client: params.testCase.client,
        connection: params.testCase.fireConnection,
        deliveryId,
        webhook: {body: {message: deliveryId, delivery_id: deliveryId}},
      });
    }

    try {
      const runDetail = await waitForRunDetailMatching({
        token: params.testCase.token,
        runId: params.runId,
        timeoutMs: 8_000,
        description: `batched listener deliveries ${deliveryIds.join(', ')}`,
        matches: (candidate) =>
          batchedListenerExecutionMatches({
            runDetail: candidate,
            jobKey: LISTENER_JOB,
            sequence: 1,
            deliveryIds,
          }),
      });
      return {deliveryIds, runDetail};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Batched listener deliveries were not observed');
}

const untilWorkflow = `
name: Listener until
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
    steps:
      - key: show-event
        env:
          MESSAGE: '\${{ execution.events[0].data.body.message }}'
          DELIVERY_ID: '\${{ execution.events[0].delivery_id }}'
        run: |
          echo "listener_message=$MESSAGE"
          echo "listener_delivery=$DELIVERY_ID"
  deploy:
    needs: listen
    steps:
      - key: after-listener
        run: echo "deploy_after_listener"
`;

const maxExecutionsWorkflow = `
name: Listener max executions
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      max_executions: 2
    steps:
      - key: show-event
        env:
          MESSAGE: '\${{ execution.events[0].data.body.message }}'
        run: echo "listener_message=$MESSAGE"
`;

const batchWorkflow = `
name: Listener batch
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
      batch:
        max_size: 2
    steps:
      - key: show-batch
        env:
          FIRST_DELIVERY: '\${{ execution.events[0].delivery_id }}'
          SECOND_DELIVERY: '\${{ execution.events[1].delivery_id }}'
        run: |
          echo "batch_first=$FIRST_DELIVERY"
          echo "batch_second=$SECOND_DELIVERY"
`;

const cancelWorkflow = `
name: Listener cancel
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
      on_resolve: cancel
    steps:
      - key: slow
        run: |
          echo "listener_started"
          sleep 30
          echo "listener_done"
`;

test.describe('listener jobs', () => {
  test('fires on webhook events and resolves on an until event', async ({suite}, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'until-resolution',
        workflowYaml: untilWorkflow,
        attach: (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
      });
      runId = await fireManualRun(testCase);

      const fire = await sendFire(testCase, runId, 'fire', 'hello-listener');
      const resolveDeliveryId = await sendResolve(testCase, 'resolve');
      const resolved = await waitForListenerResolution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        status: 'succeeded',
        reason: 'until',
        timeoutMs: 60_000,
      });
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: 180_000,
        runner: testCase.runner,
      });

      const listen = terminal.jobs.find((job) => job.key === LISTENER_JOB);
      const deploy = terminal.jobs.find((job) => job.key === 'deploy');
      const logs = await stepLogText({
        runDetail: terminal,
        token: testCase.token,
        jobKey: LISTENER_JOB,
        sequence: 1,
        stepKey: 'show-event',
      });
      expect(resolved.jobs.find((job) => job.key === LISTENER_JOB)?.resolution_reason).toBe(
        'until',
      );
      expect(terminal.status).toBe('succeeded');
      expect(listen?.listener_status).toBe('resolved');
      expect(listen?.job_executions[0]?.trigger_events[0]?.delivery_id).toBe(fire.deliveryId);
      expect(deploy?.status).toBe('succeeded');
      expect(logs).toContain('listener_message=hello-listener');
      expect(logs).toContain(`listener_delivery=${fire.deliveryId}`);
      expect(resolveDeliveryId).toContain('resolve');
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });

  test('resolves after max executions', async ({suite}, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'max-executions',
        workflowYaml: maxExecutionsWorkflow,
        attach: (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
      });
      runId = await fireManualRun(testCase);

      const first = await sendFire(testCase, runId, 'fire-one', 'first');
      const second = await sendFire(testCase, runId, 'fire-two', 'second');
      const resolved = await waitForListenerResolution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        status: 'succeeded',
        reason: 'max_executions',
        timeoutMs: 90_000,
      });
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: 180_000,
        runner: testCase.runner,
      });

      const listen = terminal.jobs.find((job) => job.key === LISTENER_JOB);
      expect(terminal.status).toBe('succeeded');
      expect(resolved.jobs.find((job) => job.key === LISTENER_JOB)?.resolution_reason).toBe(
        'max_executions',
      );
      expect(listen?.job_executions.map((execution) => execution.sequence)).toEqual([1, 2]);
      expect(listen?.job_executions[0]?.trigger_events[0]?.delivery_id).toBe(first.deliveryId);
      expect(listen?.job_executions[1]?.trigger_events[0]?.delivery_id).toBe(second.deliveryId);
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });

  test('batches multiple events into one listener execution', async ({suite}, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'batching',
        workflowYaml: batchWorkflow,
        attach: (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
      });
      runId = await fireManualRun(testCase);

      const batch = await sendBatchPairUntilObserved({testCase, runId, label: 'batch'});
      await sendResolve(testCase, 'resolve-batch');
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: 180_000,
        runner: testCase.runner,
      });

      const listen = terminal.jobs.find((job) => job.key === LISTENER_JOB);
      const logs = await stepLogText({
        runDetail: terminal,
        token: testCase.token,
        jobKey: LISTENER_JOB,
        sequence: 1,
        stepKey: 'show-batch',
      });
      expect(terminal.status).toBe('succeeded');
      expect(listen?.resolution_reason).toBe('until');
      expect(listen?.job_executions).toHaveLength(1);
      expect(listen?.job_executions[0]?.trigger_events.map((event) => event.delivery_id)).toEqual(
        batch.deliveryIds,
      );
      expect(logs).toContain(`batch_first=${batch.deliveryIds[0]}`);
      expect(logs).toContain(`batch_second=${batch.deliveryIds[1]}`);
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });

  test('cancels an active execution when on_resolve is cancel', async ({suite}, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'cancel-on-resolve',
        workflowYaml: cancelWorkflow,
        attach: (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
      });
      runId = await fireManualRun(testCase);

      await sendFire(testCase, runId, 'fire', 'slow');
      await waitForListenerExecution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        sequence: 1,
        status: 'running',
        timeoutMs: 90_000,
      });
      await sendResolve(testCase, 'resolve-cancel');
      const resolved = await waitForListenerResolution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        status: 'succeeded',
        reason: 'until',
        timeoutMs: 90_000,
      });
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: 180_000,
        runner: testCase.runner,
      });

      const listen = terminal.jobs.find((job) => job.key === LISTENER_JOB);
      expect(terminal.status).toBe('succeeded');
      expect(resolved.jobs.find((job) => job.key === LISTENER_JOB)?.listener_status).toBe(
        'resolved',
      );
      expect(listen?.job_executions[0]?.status).toBe('cancelled');
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });
});

import {
  findListenerExecutionByDeliveryIds,
  waitForListenerExecution,
  waitForListenerResolution,
  waitForListenerStatus,
} from '#listener-helpers.js';
import {
  cleanupListenerCase,
  fireManualRun,
  LISTENER_JOB,
  type ListenerCase,
  listenerWorkflows,
  sendBatchPairAndAwaitExecution,
  sendFire,
  sendResolve,
  setupListenerCase,
  stepLogText,
  stopRunner,
} from '#listener-jobs.js';
import {waitForRunTerminalOrFailedRunner} from '#runner.js';
import {expect, test} from './fixtures.js';

test.describe('listener jobs', () => {
  test('creates multiple executions before resolving on an until event', async ({
    suite,
  }, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      await test.step('start listener run', async () => {
        testCase = await setupListenerCase({
          suite,
          testName: 'until-resolution',
          workflowYaml: listenerWorkflows.untilResolution,
          attach: (attachment) =>
            testInfo.attach(attachment.name, {
              body: attachment.body,
              contentType: attachment.contentType,
            }),
        });
        runId = await fireManualRun(testCase);
      });

      let firstFire: Awaited<ReturnType<typeof sendFire>> | undefined;
      let secondFire: Awaited<ReturnType<typeof sendFire>> | undefined;
      let resolveDeliveryId: string | undefined;
      let resolved: Awaited<ReturnType<typeof waitForListenerResolution>> | undefined;
      await test.step('resolve after two fire deliveries', async () => {
        if (!testCase || !runId) throw new Error('Listener run was not started');
        firstFire = await sendFire(testCase, runId, 'fire-one', 'hello-listener');
        secondFire = await sendFire(testCase, runId, 'fire-two', 'hello-again');
        resolveDeliveryId = await sendResolve(testCase, 'resolve');
        resolved = await waitForListenerResolution({
          token: testCase.token,
          runId,
          jobKey: LISTENER_JOB,
          status: 'succeeded',
          reason: 'until',
          timeoutMs: 60_000,
        });
      });

      await test.step('assert listener outputs', async () => {
        if (!testCase || !runId) throw new Error('Listener run was not started');
        if (!firstFire || !secondFire || !resolveDeliveryId || !resolved) {
          throw new Error('Listener deliveries were not resolved');
        }
        const terminal = await waitForRunTerminalOrFailedRunner({
          runId,
          token: testCase.token,
          timeoutMs: 180_000,
          runner: testCase.runner,
        });

        const listen = terminal.jobs.find((job) => job.key === LISTENER_JOB);
        const deploy = terminal.jobs.find((job) => job.key === 'deploy');
        const firstExecution = findListenerExecutionByDeliveryIds({
          runDetail: terminal,
          jobKey: LISTENER_JOB,
          deliveryIds: firstFire.deliveryIds,
        })?.execution;
        const secondExecution = findListenerExecutionByDeliveryIds({
          runDetail: terminal,
          jobKey: LISTENER_JOB,
          deliveryIds: secondFire.deliveryIds,
        })?.execution;
        if (!firstExecution || !secondExecution) {
          throw new Error('Expected both listener fire deliveries to create executions');
        }
        const firstDeliveryId = firstExecution.trigger_events[0]?.delivery_id;
        const secondDeliveryId = secondExecution.trigger_events[0]?.delivery_id;
        if (!firstDeliveryId || !secondDeliveryId) {
          throw new Error('Expected listener executions to include trigger deliveries');
        }
        const firstLogs = await stepLogText({
          runDetail: terminal,
          token: testCase.token,
          jobKey: LISTENER_JOB,
          sequence: firstExecution.sequence,
          stepKey: 'show_event',
        });
        const secondLogs = await stepLogText({
          runDetail: terminal,
          token: testCase.token,
          jobKey: LISTENER_JOB,
          sequence: secondExecution.sequence,
          stepKey: 'show_event',
        });
        const deployExecution = deploy?.job_executions.at(-1);
        if (!deployExecution) throw new Error('Expected deploy execution');
        const deployLogs = await stepLogText({
          runDetail: terminal,
          token: testCase.token,
          jobKey: 'deploy',
          sequence: deployExecution.sequence,
          stepKey: 'after-listener',
        });

        expect(resolved.jobs.find((job) => job.key === LISTENER_JOB)?.resolution_reason).toBe(
          'until',
        );
        expect(terminal.status).toBe('succeeded');
        expect(listen?.listener_status).toBe('resolved');
        expect(listen?.job_executions.length).toBeGreaterThanOrEqual(2);
        expect(firstExecution.sequence).not.toBe(secondExecution.sequence);
        expect(deploy?.status).toBe('succeeded');
        expect(firstFire.deliveryIds).toContain(firstDeliveryId);
        expect(secondFire.deliveryIds).toContain(secondDeliveryId);
        expect(firstLogs).toContain('listener_message=hello-listener');
        expect(firstLogs).toContain(`listener_delivery=${firstDeliveryId}`);
        expect(secondLogs).toContain('listener_message=hello-again');
        expect(secondLogs).toContain(`listener_delivery=${secondDeliveryId}`);
        expect(deployLogs).toContain('listener_last=hello-again');
        expect(deployLogs).toContain('listener_count=2');
        expect(resolveDeliveryId).toContain('resolve');
      });
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
        workflowYaml: listenerWorkflows.maxExecutions,
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
      const firstExecutionDeliveryId = listen?.job_executions[0]?.trigger_events[0]?.delivery_id;
      const secondExecutionDeliveryId = listen?.job_executions[1]?.trigger_events[0]?.delivery_id;
      expect(firstExecutionDeliveryId).toBeDefined();
      expect(secondExecutionDeliveryId).toBeDefined();
      expect(first.deliveryIds).toContain(firstExecutionDeliveryId);
      expect(second.deliveryIds).toContain(secondExecutionDeliveryId);
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
        workflowYaml: listenerWorkflows.batch,
        attach: (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
      });
      runId = await fireManualRun(testCase);

      await waitForListenerStatus({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        listenerStatus: 'listening',
        timeoutMs: 8_000,
      });
      await sendBatchPairAndAwaitExecution({
        testCase,
        runId,
        label: 'readiness',
        sequence: 1,
      });
      await waitForListenerExecution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        sequence: 1,
        status: 'succeeded',
        timeoutMs: 8_000,
      });
      const batch = await sendBatchPairAndAwaitExecution({
        testCase,
        runId,
        label: 'batch',
        sequence: 2,
      });
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
        sequence: 2,
        stepKey: 'show-batch',
      });
      expect(terminal.status).toBe('succeeded');
      expect(listen?.resolution_reason).toBe('until');
      expect(listen?.job_executions).toHaveLength(2);
      expect(listen?.job_executions[1]?.trigger_events.map((event) => event.delivery_id)).toEqual(
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
        workflowYaml: listenerWorkflows.cancelOnResolve,
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

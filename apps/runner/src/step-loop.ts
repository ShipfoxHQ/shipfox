import type {NextStepResponseDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {KyInstance} from 'ky';
import {HTTPError, reportStep, requestNextStep} from '#api-client.js';
import {executeRunStep, type StepResult} from '#run-step.js';
import {executeSetupStep} from '#setup-step.js';

// Reporting a step before pulling the next one is the safety invariant: a lost report is
// retried in place (next/report are idempotent), so a step is never re-pulled or
// re-executed. An abort mid-step stops without reporting, leaving the job for lease expiry.
export async function runJobSteps(params: {
  jobId: string;
  leaseClient: KyInstance;
  signal: AbortSignal;
  cwd: string;
}): Promise<void> {
  const {jobId, leaseClient, signal, cwd} = params;

  // The setup step (position 0) prepares the workspace; every run step assumes it
  // ran. This guard makes the invariant explicit: a run step pulled before a
  // successful setup is reported as a clean failure rather than spawning against an
  // unprepared cwd. It assumes one runner executes a job's full lifecycle, which
  // holds today (a job is never re-dispatched mid-flight).
  let workspacePrepared = false;

  while (!signal.aborted) {
    let next: NextStepResponseDto;
    try {
      next = await requestNextStep(leaseClient, {signal});
    } catch (error) {
      if (error instanceof HTTPError && error.response.status === 404) {
        logger().info({jobId}, 'No job for this lease (404); stopping step loop');
        return;
      }
      throw error;
    }

    if (next.kind === 'done') {
      logger().info({jobId, status: next.status}, 'No more steps; stopping step loop');
      return;
    }

    if (signal.aborted) return;

    const {step, attempt} = next;
    const stepLabel = step.name ?? `step #${step.position}`;
    logger().info(
      {jobId, stepId: step.id, stepName: step.name, position: step.position, attempt},
      `Running ${stepLabel}`,
    );

    let result: StepResult;
    try {
      if (step.type === 'setup') {
        result = await executeSetupStep({cwd});
        if (result.success) workspacePrepared = true;
      } else if (!workspacePrepared) {
        // Invariant violation (a run step before setup prepared the cwd), not a
        // setup-phase failure, so no `reason`. step.type is 'run' so the server
        // derives category 'user'. Only reachable for a setup-less in-flight job
        // hitting a new runner during the rollout window.
        result = {
          success: false,
          output: '',
          error: {message: 'Run step dispatched before setup prepared the workspace'},
          exit_code: null,
        };
      } else {
        result = await executeRunStep(step, {signal, cwd});
      }
    } catch (error) {
      // A local executor failure (e.g. writing the temp script) throws before a
      // StepResult exists. Report the step failed so it does not hang `running`.
      logger().error(
        {err: error, jobId, stepId: step.id},
        `Step ${stepLabel} crashed before producing a result`,
      );
      result = {
        success: false,
        output: '',
        error: {message: error instanceof Error ? error.message : String(error)},
        exit_code: null,
      };
    }

    if (signal.aborted) return;

    if (result.success) {
      logger().info({jobId, stepId: step.id, stepName: step.name}, `Step ${stepLabel} succeeded`);
    } else {
      logger().error(
        {jobId, stepId: step.id, stepName: step.name, reason: result.error?.reason},
        `Step ${stepLabel} failed`,
      );
    }

    const report = await reportStep(leaseClient, {
      stepId: step.id,
      attempt,
      status: result.success ? 'succeeded' : 'failed',
      // null on success, the error shape on failure — matches reportStepBodySchema's refine.
      error: result.error,
      exitCode: result.exit_code,
      signal,
    });

    if (report.cancel) {
      logger().info(
        {jobId, stepId: step.id},
        'Job finished without full success; stopping step loop',
      );
      return;
    }
  }
}

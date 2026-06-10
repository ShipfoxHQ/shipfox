import type {ReportStepBodyDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {nextStep, reportStep} from '#api-client.js';
import {executeRunStep, type StepResult} from '#run-step.js';

export interface ExecuteJobResult {
  status: 'succeeded' | 'failed';
}

// Drive a leased job one step at a time: pull the next step, run it, report the
// result, repeat. The host is the source of truth — it tells us when the job is
// done and whether to stop early (`cancel`) after a failure cancelled the rest.
export async function executeJob(
  params: {leaseToken: string},
  options: {signal?: AbortSignal} = {},
): Promise<ExecuteJobResult> {
  for (;;) {
    if (options.signal?.aborted) throw new JobAbortedError();

    const next = await nextStep(params.leaseToken);
    if (next.kind === 'done') {
      return {status: next.status};
    }

    const {step, attempt} = next;
    const label = step.name ?? `step #${step.position}`;
    logger().info(
      {stepId: step.id, stepName: step.name, position: step.position, attempt},
      `Running ${label}`,
    );

    const result = await executeRunStep(step, options);

    // An abort (graceful shutdown or a stale-heartbeat cancel) SIGKILLs the step,
    // which resolves as a failure. Abandon the job WITHOUT reporting so an infra
    // cancel is not recorded as a genuine step failure; the server-side job
    // timeout reclaims it.
    if (options.signal?.aborted) throw new JobAbortedError();

    if (result.success) {
      logger().info({stepId: step.id, stepName: step.name}, `Step ${label} succeeded`);
    } else {
      logger().error({stepId: step.id, stepName: step.name}, `Step ${label} failed`);
    }

    const report = await reportStep(params.leaseToken, step.id, toReportBody(result, attempt));
    // The host cancelled the remaining steps; the job finished without success.
    if (report.cancel) {
      return {status: 'failed'};
    }
  }
}

// Thrown when the job is abandoned mid-run because of an abort. runJob catches
// it and leaves the job for the server-side timeout to reclaim.
export class JobAbortedError extends Error {
  constructor() {
    super('Job aborted; abandoned without reporting');
    this.name = 'JobAbortedError';
  }
}

function toReportBody(result: StepResult, attempt: number): ReportStepBodyDto {
  return result.success
    ? {status: 'succeeded', attempt, exit_code: result.exit_code}
    : {status: 'failed', attempt, exit_code: result.exit_code, error: result.error};
}

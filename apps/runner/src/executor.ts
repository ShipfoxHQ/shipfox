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

function toReportBody(result: StepResult, attempt: number): ReportStepBodyDto {
  return result.success
    ? {status: 'succeeded', attempt, exit_code: result.exit_code}
    : {status: 'failed', attempt, exit_code: result.exit_code, error: result.error};
}

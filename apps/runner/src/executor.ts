import type {JobPayloadDto, StepResultDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {executeRunStep} from '#run-step.js';

export interface ExecuteJobResult {
  status: 'succeeded' | 'failed';
  steps: StepResultDto[];
}

export async function executeJob(
  job: JobPayloadDto,
  options: {signal?: AbortSignal} = {},
): Promise<ExecuteJobResult> {
  const steps = [...job.steps].sort((a, b) => a.position - b.position);
  const reported: StepResultDto[] = [];

  for (const step of steps) {
    const stepLabel = step.name ?? `step #${step.position}`;
    logger().info(
      {stepId: step.id, stepName: step.name, position: step.position},
      `Running ${stepLabel}`,
    );

    const result = await executeRunStep(step, options);

    if (!result.success) {
      logger().error({stepId: step.id, stepName: step.name}, `Step ${stepLabel} failed`);
      reported.push({step_id: step.id, status: 'failed', error: result.error});
      return {status: 'failed', steps: reported};
    }

    logger().info({stepId: step.id, stepName: step.name}, `Step ${stepLabel} succeeded`);
    reported.push({step_id: step.id, status: 'succeeded', error: null});
  }

  return {status: 'succeeded', steps: reported};
}

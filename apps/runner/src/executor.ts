import type {JobPayloadDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {executeRunStep} from '#run-step.js';

export interface ExecuteJobResult {
  status: 'succeeded' | 'failed';
  output: string;
}

export async function executeJob(
  job: JobPayloadDto,
  options: {signal?: AbortSignal} = {},
): Promise<ExecuteJobResult> {
  const steps = [...job.steps].sort((a, b) => a.position - b.position);
  let output = '';

  for (const step of steps) {
    const stepLabel = step.name ?? `step #${step.position}`;
    logger().info(
      {stepId: step.id, stepName: step.name, position: step.position},
      `Running ${stepLabel}`,
    );

    const result = await executeRunStep(step, options);
    output += result.output;

    if (!result.success) {
      logger().error({stepId: step.id, stepName: step.name}, `Step ${stepLabel} failed`);
      return {status: 'failed', output};
    }

    logger().info({stepId: step.id, stepName: step.name}, `Step ${stepLabel} succeeded`);
  }

  return {status: 'succeeded', output};
}

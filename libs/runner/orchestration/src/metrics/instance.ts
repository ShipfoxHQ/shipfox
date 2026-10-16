import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('runner-orchestration');

const jobStepsInFlight = meter.createGauge('runner_job_steps_in_flight', {
  description: 'Step attempts the runner holds for its job, until their reports return',
});

export function recordJobStepsInFlight(count: number): void {
  try {
    jobStepsInFlight.record(count);
  } catch {
    // Metrics must not affect step execution.
  }
}

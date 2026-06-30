import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getJobExecutionQueueDepth} from '#db/job-executions.js';

export function registerRunnersServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('runners');

  const pendingJobExecutions = meter.createObservableGauge('runners_pending_job_executions', {
    description: 'Job executions currently waiting in the queue to be claimed',
  });
  const runningJobExecutions = meter.createObservableGauge('runners_running_job_executions', {
    description: 'Job executions currently claimed by a runner and in progress',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const depth = await getJobExecutionQueueDepth();
      observer.observe(pendingJobExecutions, depth.pendingJobExecutions);
      observer.observe(runningJobExecutions, depth.runningJobExecutions);
    },
    [pendingJobExecutions, runningJobExecutions],
  );
}

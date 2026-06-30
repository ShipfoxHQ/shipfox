import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getWorkflowJobExecutionDepth} from '#db/workflow-runs.js';

export function registerWorkflowsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('workflows');

  const runningRuns = meter.createObservableGauge('workflows_running_runs', {
    description: 'Workflow runs currently marked running',
  });
  const runningJobExecutions = meter.createObservableGauge('workflows_running_job_executions', {
    description: 'Workflow job executions currently marked running',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const depth = await getWorkflowJobExecutionDepth();
      observer.observe(runningRuns, depth.runningRuns);
      observer.observe(runningJobExecutions, depth.runningJobExecutions);
    },
    [runningRuns, runningJobExecutions],
  );
}

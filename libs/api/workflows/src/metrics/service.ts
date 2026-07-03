import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countActiveListeners} from '#db/job-listeners.js';
import {getWorkflowJobExecutionDepth} from '#db/workflow-runs.js';

export function registerWorkflowsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('workflows');

  const runningRuns = meter.createObservableGauge('workflows_running_runs', {
    description: 'Workflow runs currently marked running',
  });
  const runningJobExecutions = meter.createObservableGauge('workflows_running_job_executions', {
    description: 'Workflow job executions currently marked running',
  });
  const activeListeners = meter.createObservableGauge('workflows_active_listeners', {
    description: 'Workflow jobs currently marked as listening',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const [depth, listenerCount] = await Promise.all([
        getWorkflowJobExecutionDepth(),
        countActiveListeners(),
      ]);
      observer.observe(runningRuns, depth.runningRuns);
      observer.observe(runningJobExecutions, depth.runningJobExecutions);
      observer.observe(activeListeners, listenerCount);
    },
    [runningRuns, runningJobExecutions, activeListeners],
  );
}

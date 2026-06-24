import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getWorkflowExecutionDepth} from '#db/workflow-runs.js';

export function registerWorkflowsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('workflows');

  const runningRuns = meter.createObservableGauge('workflows_running_runs', {
    description: 'Workflow runs currently marked running',
  });
  const runningJobs = meter.createObservableGauge('workflows_running_jobs', {
    description: 'Workflow jobs currently marked running',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const depth = await getWorkflowExecutionDepth();
      observer.observe(runningRuns, depth.runningRuns);
      observer.observe(runningJobs, depth.runningJobs);
    },
    [runningRuns, runningJobs],
  );
}

import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getJobQueueDepth} from '#db/jobs.js';

/**
 * Registers the job-queue depth gauges. Wired to `runnersModule.metrics`, so it
 * runs once at app startup via `registerModuleMetrics`, never at import time,
 * which would bind the metrics port and break unit tests that import this
 * module. The single batch callback reads both counts from one round trip on
 * each scrape.
 */
export function registerRunnersServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('runners');

  const pendingJobs = meter.createObservableGauge('runners_pending_jobs', {
    description: 'Jobs currently waiting in the queue to be claimed',
  });
  const runningJobs = meter.createObservableGauge('runners_running_jobs', {
    description: 'Jobs currently claimed by a runner and in progress',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      const depth = await getJobQueueDepth();
      observer.observe(pendingJobs, depth.pending);
      observer.observe(runningJobs, depth.running);
    },
    [pendingJobs, runningJobs],
  );
}

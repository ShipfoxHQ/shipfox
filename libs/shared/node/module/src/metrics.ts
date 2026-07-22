import {instanceMetrics} from '@shipfox/node-opentelemetry';
import {activityInfo} from '@temporalio/activity';

interface ModuleActivityLabels {
  [key: string]: string;
  module: string;
  task_queue: string;
  activity: string;
}

interface ModuleActivityExecutionLabels extends ModuleActivityLabels {
  outcome: 'success' | 'failure';
}

const meter = instanceMetrics.getMeter('node-module');
const activityExecution = meter.createCounter<ModuleActivityExecutionLabels>(
  'module_worker_activity_execution',
  {description: 'Module worker activity attempts by outcome'},
);
const activityFailure = meter.createCounter<ModuleActivityLabels>(
  'module_worker_activity_failure',
  {
    description: 'Failed module worker activity attempts',
  },
);
const activityRetry = meter.createCounter<ModuleActivityLabels>('module_worker_activity_retry', {
  description: 'Module worker activity attempts after the first attempt',
});
const activityDuration = meter.createHistogram<ModuleActivityExecutionLabels>(
  'module_worker_activity_duration',
  {
    description: 'Module worker activity processing duration by outcome',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 15000, 60000],
    },
  },
);

type Activity = (...args: never[]) => unknown;

export function instrumentModuleActivities({
  moduleName,
  taskQueue,
  activities,
  getAttempt = () => activityInfo().attempt,
}: {
  moduleName: string;
  taskQueue: string;
  activities: object;
  getAttempt?: () => number;
}): object {
  return Object.fromEntries(
    Object.entries(activities).map(([activity, implementation]) => {
      if (typeof implementation !== 'function') return [activity, implementation];
      const labels: ModuleActivityLabels = {
        module: moduleName,
        task_queue: taskQueue,
        activity,
      };
      return [activity, instrumentActivity(implementation as Activity, labels, getAttempt)];
    }),
  );
}

function instrumentActivity(
  implementation: Activity,
  labels: ModuleActivityLabels,
  getAttempt: () => number,
): Activity {
  return async function instrumentedActivity(this: unknown, ...args: never[]) {
    const start = performance.now();
    if (getAttempt() > 1) activityRetry.add(1, labels);
    try {
      const result = await implementation.apply(this, args);
      const executionLabels = {...labels, outcome: 'success' as const};
      activityExecution.add(1, executionLabels);
      activityDuration.record(performance.now() - start, executionLabels);
      return result;
    } catch (error) {
      const executionLabels = {...labels, outcome: 'failure' as const};
      activityExecution.add(1, executionLabels);
      activityFailure.add(1, labels);
      activityDuration.record(performance.now() - start, executionLabels);
      throw error;
    }
  };
}

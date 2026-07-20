import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getRegisteredPublisherNames, type ShipfoxModule} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {DISPATCHER_TASK_QUEUE, OUTBOX_RETENTION_WORKFLOW_ID} from '#core/constants.js';
import {createOutboxDrainerService} from '#core/outbox-drainer-service.js';
import {registerDispatcherServiceMetrics} from '#metrics/index.js';
import {createActivities} from '#temporal/index.js';

// Temporal's webpack bundler requires a compiled .js file. Whether running from
// src/ (dev) or dist/ (prod), the parent of the current directory is the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/retention.js');

export function createDispatcherModule(
  options: {enabled?: boolean; pollMs?: number} = {},
): ShipfoxModule {
  const enabled = options.enabled ?? config.OUTBOX_DISPATCHER_ENABLED;
  const pollMs = options.pollMs ?? config.OUTBOX_DISPATCH_POLL_MS;

  return {
    name: 'dispatcher',
    startupTasks: ({outboxRegistry}) => {
      const publisherNames = getRegisteredPublisherNames(outboxRegistry);
      if (publisherNames.length === 0) {
        throw new Error(
          'Outbox dispatcher has no registered publishers. Ensure module initialization provides the registry that contains this application’s publishers before starting dispatch.',
        );
      }

      logger().info(
        {publisherCount: publisherNames.length, publisherNames},
        'Outbox dispatcher publishers registered',
      );

      return Promise.resolve();
    },
    metrics: registerDispatcherServiceMetrics,
    ...(enabled ? {services: [createOutboxDrainerService({pollMs})]} : {}),
    workers: [
      {
        taskQueue: DISPATCHER_TASK_QUEUE,
        workflowsPath,
        activities: createActivities,
        workflows: [
          {
            name: 'outboxRetentionWorkflow',
            id: OUTBOX_RETENTION_WORKFLOW_ID,
            cronSchedule: '0 0 * * *',
          },
        ],
      },
    ],
  };
}

export const dispatcherModule = createDispatcherModule();

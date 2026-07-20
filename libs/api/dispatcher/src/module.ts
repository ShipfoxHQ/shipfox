import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ShipfoxModule} from '@shipfox/node-module';
import {config} from '#config.js';
import {
  DISPATCHER_TASK_QUEUE,
  DISPATCHER_WORKER_COUNT,
  DISPATCHER_WORKFLOW_ID,
  OUTBOX_RETENTION_WORKFLOW_ID,
} from '#core/constants.js';
import {createOutboxDrainerService} from '#core/outbox-drainer-service.js';
import {createActivities} from '#temporal/index.js';

// Temporal's webpack bundler requires a compiled .js file. Whether running from
// src/ (dev) or dist/ (prod), the parent of the current directory is the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/dispatch.js');

export function createDispatcherModule(
  options: {enabled?: boolean; pollMs?: number} = {},
): ShipfoxModule {
  const enabled = options.enabled ?? config.OUTBOX_DISPATCHER_ENABLED;
  const pollMs = options.pollMs ?? config.OUTBOX_DISPATCH_POLL_MS;

  // The in-process drainer and the Temporal dispatch workflows both drain the
  // same outbox rows; only one may run at a time or claim-lease expiry during
  // an in-flight handler call lets the other re-run it, firing side effects twice.
  const dispatchWorkflows = enabled
    ? []
    : [
        {
          name: 'outboxDispatcherWorkflow',
          id: DISPATCHER_WORKFLOW_ID,
          args: [{workerIndex: 0, workerCount: DISPATCHER_WORKER_COUNT}],
        },
        ...Array.from({length: DISPATCHER_WORKER_COUNT - 1}, (_, index) => {
          const workerIndex = index + 1;
          return {
            name: 'outboxDispatcherWorkflow',
            id: `${DISPATCHER_WORKFLOW_ID}-${workerIndex}`,
            args: [{workerIndex, workerCount: DISPATCHER_WORKER_COUNT}],
          };
        }),
      ];

  return {
    name: 'dispatcher',
    ...(enabled ? {services: [createOutboxDrainerService({pollMs})]} : {}),
    workers: [
      {
        taskQueue: DISPATCHER_TASK_QUEUE,
        workflowsPath,
        activities: createActivities,
        workflows: [
          ...dispatchWorkflows,
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

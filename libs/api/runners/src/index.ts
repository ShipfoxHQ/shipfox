import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runnersEventSchemas} from '@shipfox/api-runners-dto';
import {
  WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, runnersOutbox} from '#db/index.js';
import type {CreateRunnersModuleOptions} from '#installation-provisioning.js';
import {registerRunnersServiceMetrics} from '#metrics/index.js';
import {
  createProvisionerTokenAuthMethod,
  createRunnerRegistrationTokenAuthMethod,
  createRunnerRoutes,
  onWorkflowsJobExecutionTimedOut,
} from '#presentation/index.js';
import {createRunnersInterModulePresentation} from '#presentation/inter-module.js';
import {createRunnersMaintenanceActivities} from '#temporal/activities/index.js';
import {RUNNERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export {
  type MintEphemeralRegistrationTokenParams,
  type MintEphemeralRegistrationTokenResult,
  type MintEphemeralRegistrationTokensBatchParams,
  type MintEphemeralRegistrationTokensBatchResult,
  type MintEphemeralRegistrationTokensBatchRunnerInstance,
  mintEphemeralRegistrationToken,
  mintEphemeralRegistrationTokensBatch,
} from '#core/ephemeral-registration-tokens.js';
export {
  type EffectiveRunnerToolCapabilitiesResult,
  getEffectiveRunnerToolCapabilities,
  unadvertisedRunnerTools,
} from '#core/runner-tool-capabilities.js';
export {
  cancelRunnerJobs,
  type EnqueueJobExecutionParams,
  enqueueJobExecution,
  isJobLeaseActive,
  releaseJobExecution,
} from '#db/index.js';
export type {
  CreateRunnersModuleOptions,
  InstallationProvisioningPolicy,
} from '#installation-provisioning.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMapDto>();

export function createRunnersModule(options: CreateRunnersModuleOptions = {}): ShipfoxModule {
  return {
    name: 'runners',
    database: {db, migrationsPath},
    auth: [createRunnerRegistrationTokenAuthMethod(), createProvisionerTokenAuthMethod()],
    routes: createRunnerRoutes(options),
    metrics: registerRunnersServiceMetrics,
    publishers: [{name: 'runners', table: runnersOutbox, db, eventSchemas: runnersEventSchemas}],
    subscribers: [subscriber(WORKFLOWS_JOB_EXECUTION_TIMED_OUT, onWorkflowsJobExecutionTimedOut)],
    workers: [
      {
        taskQueue: RUNNERS_MAINTENANCE_TASK_QUEUE,
        workflowsPath,
        activities: createRunnersMaintenanceActivities,
        workflows: [
          {name: 'stuckJobDetector', id: 'stuck-job-detector', cronSchedule: '* * * * *'},
        ],
      },
    ],
    interModulePresentations: [createRunnersInterModulePresentation()],
  };
}

export const runnersModule = createRunnersModule();

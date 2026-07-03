import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {CreateEphemeralRegistrationTokenParams} from './ephemeral-registration-tokens.js';
export {
  createEphemeralRegistrationToken,
  createRunnerSessionConsumingEphemeralToken,
  resolveEphemeralRegistrationTokenByHash,
} from './ephemeral-registration-tokens.js';
export type {
  ClaimedJobExecution,
  EnqueueJobExecutionParams,
  ProvisionedRunnerBoundJobExecution,
} from './job-executions.js';
export {
  cancelRunnerJobs,
  claimPendingJobExecution,
  enqueueJobExecution,
  expireStuckJobExecutions,
  isJobLeaseActive,
  listActiveRunningJobExecutions,
  listRunningJobExecutionsByProvisionedRunnerTx,
  recordHeartbeat,
  releaseJobExecution,
} from './job-executions.js';
export type {CreateManualRegistrationTokenParams} from './manual-registration-tokens.js';
export {
  createManualRegistrationToken,
  listUsableManualRegistrationTokensByWorkspaceId,
  resolveManualRegistrationTokenByHash,
  revokeManualRegistrationToken,
} from './manual-registration-tokens.js';
export type {
  ActiveProvisionedRunnerTemplateCount,
  ProvisionedRunnerReportEvent,
  ProvisionedRunnerTerminateIntent,
  ProvisionedRunnerTerminateIntentReason,
  ReapStaleProvisionedRunnersResult,
  ReconcileProvisionedRunnersDbResult,
  ReconcileProvisionedRunnersParams,
  ReportProvisionedRunnersParams,
} from './provisioned-runners.js';
export {
  isTerminalState,
  listActiveProvisionedRunnerCountsByTemplateTx,
  listActiveProvisionedRunners,
  listProvisionerTerminateIntentRowsTx,
  listProvisionerTerminateIntents,
  reapStaleProvisionedRunners,
  reconcileProvisionedRunners,
  reportProvisionedRunners,
} from './provisioned-runners.js';
export type {CreateProvisionerTokenParams} from './provisioner-tokens.js';
export {
  createProvisionerToken,
  listActiveProvisionerTokens,
  listUsableProvisionerTokensByWorkspaceId,
  resolveProvisionerTokenByHash,
  revokeProvisionerToken,
  touchProvisionerLastSeen,
} from './provisioner-tokens.js';
export type {
  DemandStat,
  PollDemandAndReserveParams,
  ReservationGrant,
  ReservationTemplate,
} from './reservations.js';
export {
  deleteExpiredReservations,
  deleteReservationsByIds,
  pollDemandAndReserve,
  releaseReservationUnits,
} from './reservations.js';
export type {
  CreateRunnerSessionParams,
  DeleteExpiredRunnerSessionsParams,
} from './runner-sessions.js';
export {createRunnerSession, deleteExpiredRunnerSessions} from './runner-sessions.js';
export {runnersOutbox} from './schema/outbox.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

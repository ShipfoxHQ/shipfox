import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {CreateEphemeralRegistrationTokenParams} from './ephemeral-registration-tokens.js';
export {
  createEphemeralRegistrationToken,
  createRunnerSessionConsumingEphemeralToken,
  resolveEphemeralRegistrationTokenByHash,
} from './ephemeral-registration-tokens.js';
export type {ClaimedJob, EnqueueJobParams} from './jobs.js';
export {
  cancelRunnerJobs,
  claimPendingJob,
  enqueueJob,
  expireStuckJobs,
  isJobLeaseActive,
  listActiveRunningJobs,
  recordHeartbeat,
  releaseJob,
} from './jobs.js';
export type {
  ProvisionedRunnerReportEvent,
  ReportProvisionedRunnersParams,
} from './provisioned-runners.js';
export {
  listActiveProvisionedRunners,
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
export type {CreateRunnerSessionParams} from './runner-sessions.js';
export {createRunnerSession} from './runner-sessions.js';
export type {CreateRunnerTokenParams} from './runner-tokens.js';
export {
  createRunnerToken,
  listUsableRunnerTokensByWorkspaceId,
  resolveRunnerTokenByHash,
  revokeRunnerToken,
} from './runner-tokens.js';
export {runnersOutbox} from './schema/outbox.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

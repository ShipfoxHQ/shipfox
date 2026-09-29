import {logger} from '@shipfox/node-opentelemetry';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {
  and,
  arrayContains,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {runnerReservedLabels} from '#config.js';
import type {
  InstallationPlacementPolicy,
  WorkspaceCapacityWaitDetail,
  WorkspacePlacementRules,
} from '#installation-provisioning.js';
import {
  recordPlacementResolveError,
  recordPlacementTemplateChanged,
  recordProviderRunnerActivationOutcome,
} from '#metrics/instance.js';
import {
  assignRunnerCapacityHoldTx,
  insertLaunchCapacityHoldsTx,
  releaseUnboundCapacityHoldsForReservationsTx,
} from './capacity-holds.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {denyPendingJobExecutionsTx} from './placement-denials.js';
import {lockRunnerReservationAdvisoryKeysTx} from './reservation-locks.js';
import {terminalStates} from './runner-states.js';
import {capacityHolds} from './schema/capacity-holds.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {provisionerCapabilitySnapshots} from './schema/provisioner-capability-snapshots.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {type providerRunnerLaunchKindEnum, providerRunners} from './schema/runner-instances.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export interface ReservationTemplate {
  templateKey: string;
  labels: string[];
  availableSlots: number;
  starting: number;
  running: number;
}

export interface DemandStat {
  workspaceId?: string;
  labels: string[];
  queued: number;
  reserved: number;
  oldestQueuedAt: Date;
}

export interface ReservationGrant {
  reservationId: string;
  workspaceId?: string;
  labels: string[];
  count: number;
  expiresAt: Date;
}

export interface PollDemandAndReserveParams {
  workspaceId: string;
  provisionerId: string;
  maxReservations: number;
  ttlSeconds: number;
  /** Lifetime of the short reservation that gives rebound runners time to activate. */
  activationGraceSeconds?: number;
  templates: ReservationTemplate[];
  capabilityWindowSeconds?: number;
  placement?: InstallationPlacementPolicy;
}

export interface InstallationPollDemandAndReserveParams {
  provisionerId: string;
  maxReservations: number;
  ttlSeconds: number;
  /** Lifetime of the short reservation that gives rebound runners time to activate. */
  activationGraceSeconds?: number;
  templates: ReservationTemplate[];
  capabilityWindowSeconds: number;
  eligibleWorkspaceIds: ReadonlySet<string>;
  placement?: InstallationPlacementPolicy;
  signal?: AbortSignal;
  onReservations?: (reservations: ReservationGrant[]) => void;
}

type DemandScope = 'installation' | 'workspace';

interface IdleRunnerCandidate {
  id: string;
  launchKind: (typeof providerRunnerLaunchKindEnum.enumValues)[number];
  labels: string[];
}

interface CapacityIdleRunnerCandidate extends IdleRunnerCandidate {
  capacityHold: {workspaceId: string; units: number} | undefined;
}

interface BindableRunnerParams {
  provisionerId: string;
  workspaceId: string;
  requiredLabels: string[];
  scope: DemandScope;
  /** Label sets of templates the workspace may not use. Runners of those templates stay idle. */
  refusedTemplateLabels?: string[][];
}

interface IdleRunnerSelectionParams extends BindableRunnerParams {
  count: number;
}

type PollDemandAndReserveLockedParams = PollDemandAndReserveParams & {
  scope: DemandScope;
  placementRules?: WorkspacePlacementRules;
};

interface NormalizedTemplate {
  templateKey: string;
  labels: string[];
  remainingSlots: number;
}

interface DemandRow {
  requiredLabels: string[];
  queued: number;
  oldestQueuedAt: Date;
}

interface PendingCapacityJob {
  id: string;
  requiredLabels: string[];
  createdAt: Date;
}

interface NewReservationUnits {
  labels: string[];
  count: number;
}

interface ActiveProvisionerReservationRow {
  provisionerId: string;
  requiredLabels: string[];
  /** Units still represented by a live runner that has not claimed a job. */
  reserved: number;
  /** Live units that have no unclaimed runner behind them. */
  leaked: number;
}

interface PollDemandAndReserveResult {
  stats: DemandStat[];
  /** Only launch reservations are exposed to the provisioner. */
  reservations: ReservationGrant[];
  /** Internal allocation accounting for bound and launch rows together. */
  newlyReservedUnits: NewReservationUnits[];
}

interface DemandReservationState {
  readonly templates: NormalizedTemplate[];
  readonly placementRules: WorkspacePlacementRules | undefined;
  readonly reservedByLabels: Map<string, number>;
  readonly stats: DemandStat[];
  readonly grants: ReservationGrant[];
  readonly newlyReservedUnits: NewReservationUnits[];
  readonly workspaceIdField: {workspaceId?: string};
  remainingMaxReservations: number;
}

export async function pollDemandAndReserve(
  params: PollDemandAndReserveParams,
): Promise<{stats: DemandStat[]; reservations: ReservationGrant[]}> {
  const result = await db().transaction(async (tx) => {
    return await pollDemandAndReserveTx(tx, params);
  });
  return {stats: result.stats, reservations: result.reservations};
}

export async function pollDemandAndReserveTx(
  tx: Tx,
  params: PollDemandAndReserveParams,
): Promise<PollDemandAndReserveResult> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`);
  return await pollDemandAndReserveLockedTx(tx, {...params, scope: 'workspace'});
}

export async function pollInstallationDemandAndReserve(
  params: InstallationPollDemandAndReserveParams,
): Promise<{
  stats: DemandStat[];
  reservations: ReservationGrant[];
  newlyReservedCount?: number;
}> {
  const candidateWorkspaceIds = await listInstallationDemandWorkspaceIds(
    params.eligibleWorkspaceIds,
  );
  const placementRules = await resolvePlacementRules(params.placement, candidateWorkspaceIds);
  if (!placementRules) return {stats: [], reservations: []};
  const results: PollDemandAndReserveResult[] = [];
  let remainingMaxReservations = params.maxReservations;
  const remainingTemplates = params.templates.map((template) => ({
    ...template,
    labels: [...canonicalizeLabels(template.labels)],
    remainingSlots: template.availableSlots,
  }));
  for (const workspaceId of candidateWorkspaceIds) {
    if (params.signal?.aborted) break;
    const workspacePlacementRules = placementRules.get(workspaceId);
    // A workspace with placement rules still needs its denial pass once the grant budget is spent.
    if (remainingMaxReservations === 0 && !workspacePlacementRules) continue;
    const result = await db().transaction(async (tx) => {
      const lockResult = await tx.execute<{locked: boolean}>(
        sql`select pg_try_advisory_xact_lock(hashtext(${workspaceId})) as locked`,
      );
      const locked = lockResult.rows[0];
      if (!locked?.locked) return {stats: [], reservations: [], newlyReservedUnits: []};
      return await pollDemandAndReserveLockedTx(tx, {
        workspaceId,
        provisionerId: params.provisionerId,
        maxReservations: remainingMaxReservations,
        ttlSeconds: params.ttlSeconds,
        ...(params.activationGraceSeconds !== undefined
          ? {activationGraceSeconds: params.activationGraceSeconds}
          : {}),
        templates: remainingTemplates.map((template) => ({
          ...template,
          availableSlots: template.remainingSlots,
        })),
        capabilityWindowSeconds: params.capabilityWindowSeconds,
        scope: 'installation',
        ...(params.placement ? {placement: params.placement} : {}),
        ...(workspacePlacementRules ? {placementRules: workspacePlacementRules} : {}),
      });
    });
    results.push(result);
    consumeInstallationTemplateSlots(
      remainingTemplates,
      result.reservations,
      params.placement,
      workspacePlacementRules,
    );
    params.onReservations?.(result.reservations);
    remainingMaxReservations -= result.newlyReservedUnits.reduce(
      (total, reservation) => total + reservation.count,
      0,
    );
  }
  const newlyReservedCount = results.reduce(
    (total, result) =>
      total +
      result.newlyReservedUnits.reduce((subtotal, reservation) => subtotal + reservation.count, 0),
    0,
  );
  return {
    stats: results.flatMap((result) => result.stats),
    reservations: results.flatMap((result) => result.reservations),
    ...(newlyReservedCount > 0 ? {newlyReservedCount} : {}),
  };
}

// A thrown error skips every candidate workspace for this poll. Jobs stay queued rather than
// being refused or granted on missing data.
async function resolvePlacementRules(
  placement: InstallationPlacementPolicy | undefined,
  workspaceIds: readonly string[],
): Promise<ReadonlyMap<string, WorkspacePlacementRules> | undefined> {
  if (!placement?.resolve || workspaceIds.length === 0) return new Map();
  try {
    return await placement.resolve(workspaceIds);
  } catch (error) {
    recordPlacementResolveError();
    logger().error(
      {err: error, workspaceCount: workspaceIds.length},
      'Failed to resolve placement rules; skipping workspaces for this poll',
    );
    return undefined;
  }
}

function consumeInstallationTemplateSlots(
  templates: NormalizedTemplate[],
  launchGrants: ReservationGrant[],
  placement: InstallationPlacementPolicy | undefined,
  placementRules?: WorkspacePlacementRules,
): void {
  // Adopted runners are already included in the running count behind availableSlots.
  // Only units that still need a launch consume advertised template capacity.
  for (const reservation of launchGrants) {
    drawSlots(
      orderSatisfyingTemplates(
        allowedByRules(templates, placementRules),
        reservation.labels,
        placement,
      ),
      reservation.count,
    );
  }
}

function allowedByRules(
  templates: NormalizedTemplate[],
  placementRules: WorkspacePlacementRules | undefined,
): NormalizedTemplate[] {
  return placementRules
    ? templates.filter((template) => placementRules.allowsTemplate(template.labels))
    : templates;
}

async function pollDemandAndReserveLockedTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
): Promise<PollDemandAndReserveResult> {
  let demandRows = (
    await tx
      .select({
        requiredLabels: pendingJobExecutions.requiredLabels,
        queued: sql<number>`count(*)::int`,
        oldestQueuedAt: sql<Date | string>`min(${pendingJobExecutions.createdAt})`,
      })
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.workspaceId, params.workspaceId))
      .groupBy(pendingJobExecutions.requiredLabels)
  ).map((row) => ({
    ...row,
    oldestQueuedAt: new Date(row.oldestQueuedAt),
  }));
  let capabilityLabels: string[][] = [];
  if (params.capabilityWindowSeconds !== undefined) {
    capabilityLabels = await listActiveWorkspaceCapabilityLabelsTx(tx, {
      workspaceId: params.workspaceId,
      windowSeconds: params.capabilityWindowSeconds,
    });
    demandRows = demandRows.filter(
      (demand) => !isCoveredByWorkspaceCapability(demand.requiredLabels, capabilityLabels),
    );
  }

  const activeProvisionerReservationRows = await listActiveProvisionerReservationRowsTx(tx, {
    workspaceId: params.workspaceId,
  });
  const reservedByLabels = new Map<string, number>();
  for (const row of activeProvisionerReservationRows) {
    const key = labelKey(row.requiredLabels);
    reservedByLabels.set(key, (reservedByLabels.get(key) ?? 0) + row.reserved);
  }

  const templates = params.templates.map((template) => ({
    templateKey: template.templateKey,
    labels: [...canonicalizeLabels(template.labels)],
    remainingSlots: template.availableSlots,
  }));
  deductProvisionerReservations(
    templates,
    activeProvisionerReservationRows.filter(
      (reservation) => reservation.provisionerId === params.provisionerId,
    ),
    params.placement,
  );
  const state: DemandReservationState = {
    templates,
    placementRules: params.placementRules,
    reservedByLabels,
    stats: [],
    grants: [],
    newlyReservedUnits: [],
    workspaceIdField:
      params.capabilityWindowSeconds === undefined ? {} : {workspaceId: params.workspaceId},
    remainingMaxReservations: params.maxReservations,
  };

  if (params.placementRules) {
    demandRows = await denyRefusedDemandRowsTx(tx, params, demandRows, state);
  }

  const capacityRules = capacityRulesFor(params.placement, params.placementRules);
  if (capacityRules) {
    await reserveCapacityJobsTx(tx, params, state, capacityRules, capabilityLabels);
  } else {
    for (const demand of sortDemandRows(demandRows)) {
      await reserveDemandRowTx(tx, params, demand, state);
    }
  }

  return {
    stats: state.stats,
    reservations: state.grants,
    newlyReservedUnits: state.newlyReservedUnits,
  };
}

// Runs over every demand group before any grant, so a refused job fails within one poll even
// behind a group that is waiting for capacity. A group with no reserved label is only skipped: a
// self-hosted runner could still serve it.
async function denyRefusedDemandRowsTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demandRows: DemandRow[],
  state: DemandReservationState,
): Promise<DemandRow[]> {
  const rules = state.placementRules;
  if (!rules) return demandRows;
  const remaining: DemandRow[] = [];
  for (const demand of demandRows) {
    const matching = state.templates.filter((template) =>
      isSubset(demand.requiredLabels, template.labels),
    );
    const refusedEverywhere =
      matching.length > 0 && matching.every((template) => !rules.allowsTemplate(template.labels));
    const reserved = demand.requiredLabels.some((label) => runnerReservedLabels.includes(label));
    if (!refusedEverywhere || !reserved) {
      remaining.push(demand);
      continue;
    }
    await denyPendingJobExecutionsTx(tx, {
      workspaceId: params.workspaceId,
      requiredLabels: demand.requiredLabels,
      notice: rules.denial(demand.requiredLabels),
    });
  }
  return remaining;
}

function capacityRulesFor(
  placement: InstallationPlacementPolicy | undefined,
  rules: WorkspacePlacementRules | undefined,
): (WorkspacePlacementRules & {capacityUnits: number}) | undefined {
  if (!rules || rules.capacityUnits === null) return undefined;
  if (placement?.holds !== 'require') {
    throw new Error('Capacity limits require placement holds in require mode');
  }
  return rules as WorkspacePlacementRules & {capacityUnits: number};
}

async function reserveCapacityJobsTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  state: DemandReservationState,
  rules: WorkspacePlacementRules & {capacityUnits: number},
  capabilityLabels: readonly string[][],
): Promise<void> {
  if (!params.placement) return;

  const pendingJobs = (
    await tx
      .select({
        id: pendingJobExecutions.id,
        requiredLabels: pendingJobExecutions.requiredLabels,
        createdAt: pendingJobExecutions.createdAt,
      })
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.workspaceId, params.workspaceId))
      .orderBy(asc(pendingJobExecutions.createdAt), asc(pendingJobExecutions.id))
      .limit(1000)
  ).filter(
    (job) =>
      !isCoveredByWorkspaceCapability(job.requiredLabels, capabilityLabels) &&
      capacityTemplatesForJob(state, rules, job.requiredLabels, params.placement).length > 0,
  );
  const initialReservedByLabels = new Map(state.reservedByLabels);
  const newlyGrantedByLabels = new Map<string, number>();
  let inUse = await workspaceCapacityInUseTx(tx, params.workspaceId);

  for (let index = 0; index < pendingJobs.length; index += 1) {
    const job = pendingJobs[index];
    if (!job) continue;
    const stopped = await reserveCapacityJobTx(
      tx,
      params,
      state,
      rules,
      job,
      {
        inUse,
        newlyGrantedByLabels,
        remainingJobs: pendingJobs.slice(index + 1),
      },
      capabilityLabels,
    );
    inUse = stopped.inUse;
    if (stopped.stop) break;
  }

  const demandRows = await tx
    .select({
      requiredLabels: pendingJobExecutions.requiredLabels,
      queued: sql<number>`count(*)::int`,
      oldestQueuedAt: sql<Date | string>`min(${pendingJobExecutions.createdAt})`,
    })
    .from(pendingJobExecutions)
    .where(eq(pendingJobExecutions.workspaceId, params.workspaceId))
    .groupBy(pendingJobExecutions.requiredLabels);
  for (const demand of demandRows) {
    if (
      isCoveredByWorkspaceCapability(demand.requiredLabels, capabilityLabels) ||
      capacityTemplatesForJob(state, rules, demand.requiredLabels, params.placement).length === 0
    )
      continue;
    const key = labelKey(demand.requiredLabels);
    state.stats.push({
      ...state.workspaceIdField,
      labels: demand.requiredLabels,
      queued: demand.queued,
      reserved: (initialReservedByLabels.get(key) ?? 0) + (newlyGrantedByLabels.get(key) ?? 0),
      oldestQueuedAt: new Date(demand.oldestQueuedAt),
    });
  }
}

interface CapacityJobProgress {
  inUse: number;
  newlyGrantedByLabels: Map<string, number>;
  remainingJobs: readonly PendingCapacityJob[];
}

async function reserveCapacityJobTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  state: DemandReservationState,
  rules: WorkspacePlacementRules & {capacityUnits: number},
  job: PendingCapacityJob,
  progress: CapacityJobProgress,
  capabilityLabels: readonly string[][],
): Promise<{inUse: number; stop: boolean}> {
  const allowedTemplates = capacityTemplatesForJob(
    state,
    rules,
    job.requiredLabels,
    params.placement,
  );
  if (allowedTemplates.length === 0) return {inUse: progress.inUse, stop: false};

  const key = labelKey(job.requiredLabels);
  const reserved = state.reservedByLabels.get(key) ?? 0;
  if (reserved > 0) {
    state.reservedByLabels.set(key, reserved - 1);
    await clearCapacityWaitTx(tx, job.id);
    return {inUse: progress.inUse, stop: false};
  }

  const idleRunners = await listCapacityIdleRunnerInstancesTx(tx, {
    provisionerId: params.provisionerId,
    requiredLabels: job.requiredLabels,
    count: 1,
    workspaceId: params.workspaceId,
    scope: params.scope,
    refusedTemplateLabels: state.templates
      .filter((template) => state.placementRules?.allowsTemplate(template.labels) === false)
      .map((template) => template.labels),
  });
  const idleRunner = idleRunners[0];
  const template = allowedTemplates.find((candidate) => candidate.remainingSlots > 0);
  if (!idleRunner && !template) return {inUse: progress.inUse, stop: false};
  const units = idleRunner
    ? capacityDeltaForIdleRunner(idleRunner, params.workspaceId, params.placement)
    : (params.placement?.units(template?.labels ?? []) ?? 0);
  if (progress.inUse + units > rules.capacityUnits) {
    const waitDetail = {
      inUse: progress.inUse,
      capacity: rules.capacityUnits,
      unitLabel: rules.unitLabel,
      requiredAction: rules.capacityAction ?? null,
    };
    await markCapacityWaitTx(tx, params.workspaceId, job, waitDetail);
    await markCapacityWaitForRemainingJobsTx(
      tx,
      params.workspaceId,
      progress.remainingJobs.filter((remainingJob) => {
        if (isCoveredByWorkspaceCapability(remainingJob.requiredLabels, capabilityLabels))
          return false;
        return (
          capacityTemplatesForJob(state, rules, remainingJob.requiredLabels, params.placement)
            .length > 0
        );
      }),
      waitDetail,
    );
    return {inUse: progress.inUse, stop: true};
  }
  if (state.remainingMaxReservations === 0) return {inUse: progress.inUse, stop: true};

  await grantDemandReservationTx(
    tx,
    params,
    {requiredLabels: job.requiredLabels, queued: 1, oldestQueuedAt: job.createdAt},
    allowedTemplates,
    1,
    state,
    idleRunners,
  );
  progress.newlyGrantedByLabels.set(key, (progress.newlyGrantedByLabels.get(key) ?? 0) + 1);
  await clearCapacityWaitTx(tx, job.id);
  return {inUse: progress.inUse + units, stop: false};
}

async function workspaceCapacityInUseTx(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({units: sql<number>`coalesce(sum(${capacityHolds.units}), 0)::int`})
    .from(capacityHolds)
    .where(and(eq(capacityHolds.workspaceId, workspaceId), isNull(capacityHolds.releasedAt)));
  return Number(row?.units ?? 0);
}

async function clearCapacityWaitTx(tx: Tx, pendingJobId: string): Promise<void> {
  await tx
    .update(pendingJobExecutions)
    .set({waitReason: null, waitDetail: null})
    .where(
      and(
        eq(pendingJobExecutions.id, pendingJobId),
        or(isNotNull(pendingJobExecutions.waitReason), isNotNull(pendingJobExecutions.waitDetail)),
      ),
    );
}

async function markCapacityWaitTx(
  tx: Tx,
  workspaceId: string,
  job: PendingCapacityJob,
  waitDetail: WorkspaceCapacityWaitDetail,
): Promise<void> {
  await tx
    .update(pendingJobExecutions)
    .set({waitReason: 'workspace-capacity', waitDetail})
    .where(
      and(
        eq(pendingJobExecutions.workspaceId, workspaceId),
        eq(pendingJobExecutions.id, job.id),
        or(
          isNull(pendingJobExecutions.waitReason),
          ne(pendingJobExecutions.waitReason, 'workspace-capacity'),
          isNull(pendingJobExecutions.waitDetail),
          ne(pendingJobExecutions.waitDetail, waitDetail),
        ),
      ),
    );
}

async function markCapacityWaitForRemainingJobsTx(
  tx: Tx,
  workspaceId: string,
  jobs: readonly PendingCapacityJob[],
  waitDetail: WorkspaceCapacityWaitDetail,
): Promise<void> {
  const boundaryJob = jobs[0];
  if (!boundaryJob) return;
  await tx
    .update(pendingJobExecutions)
    .set({waitReason: 'workspace-capacity', waitDetail})
    .where(
      and(
        eq(pendingJobExecutions.workspaceId, workspaceId),
        sql`(${pendingJobExecutions.createdAt}, ${pendingJobExecutions.id}) >= (
          select ${pendingJobExecutions.createdAt}, ${pendingJobExecutions.id}
          from ${pendingJobExecutions}
          where ${eq(pendingJobExecutions.id, boundaryJob.id)}
        )`,
        or(
          isNull(pendingJobExecutions.waitReason),
          ne(pendingJobExecutions.waitReason, 'workspace-capacity'),
          isNull(pendingJobExecutions.waitDetail),
          ne(pendingJobExecutions.waitDetail, waitDetail),
        ),
      ),
    );
}

async function reserveDemandRowTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  state: DemandReservationState,
): Promise<void> {
  const allowedTemplates = orderSatisfyingTemplates(
    allowedByRules(state.templates, state.placementRules),
    demand.requiredLabels,
    params.placement,
  );
  if (allowedTemplates.length === 0) return;
  const reserved = state.reservedByLabels.get(labelKey(demand.requiredLabels)) ?? 0;
  const capacity = allowedTemplates.reduce((total, template) => total + template.remainingSlots, 0);
  const grant = Math.min(
    Math.max(0, demand.queued - reserved),
    capacity,
    state.remainingMaxReservations,
  );
  if (grant > 0 && params.maxReservations > 0) {
    await grantDemandReservationTx(tx, params, demand, allowedTemplates, grant, state);
  }
  state.stats.push({
    ...state.workspaceIdField,
    labels: demand.requiredLabels,
    queued: demand.queued,
    reserved: reserved + grant,
    oldestQueuedAt: demand.oldestQueuedAt,
  });
}

async function grantDemandReservationTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  allowedTemplates: NormalizedTemplate[],
  grant: number,
  state: DemandReservationState,
  selectedIdleRunners?: IdleRunnerCandidate[],
): Promise<void> {
  const idleRunners =
    selectedIdleRunners ??
    (await listIdleRunnerInstancesTx(tx, {
      provisionerId: params.provisionerId,
      requiredLabels: demand.requiredLabels,
      count: grant,
      workspaceId: params.workspaceId,
      scope: params.scope,
      refusedTemplateLabels: state.templates
        .filter((template) => state.placementRules?.allowsTemplate(template.labels) === false)
        .map((template) => template.labels),
    }));
  state.remainingMaxReservations -= grant;
  if (idleRunners.length > 0) {
    await bindDemandReservationTx(tx, params, demand, idleRunners);
  }
  const launchCount = grant - idleRunners.length;
  const launchUnits = params.placement
    ? allocateLaunchUnits(allowedTemplates, launchCount, params.placement)
    : [];
  if (params.placement) countChangedTemplates(allowedTemplates, launchCount, params.placement);
  drawSlots(allowedTemplates, launchCount);
  const launchReservation = await insertLaunchReservationTx(tx, params, demand, launchCount);
  if (launchReservation && params.placement) {
    await insertLaunchCapacityHoldsTx(tx, {
      workspaceId: params.workspaceId,
      reservationId: launchReservation.id,
      units: launchUnits,
    });
  }
  state.newlyReservedUnits.push({labels: demand.requiredLabels, count: grant});
  if (launchReservation) {
    state.grants.push({
      reservationId: launchReservation.id,
      ...state.workspaceIdField,
      labels: demand.requiredLabels,
      count: launchCount,
      expiresAt: launchReservation.expiresAt,
    });
  }
}

async function bindDemandReservationTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  idleRunners: IdleRunnerCandidate[],
): Promise<void> {
  const [reservation] = await tx
    .insert(reservations)
    .values({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      requiredLabels: demand.requiredLabels,
      count: idleRunners.length,
      kind: 'bound',
      expiresAt: sql`now() + (${params.activationGraceSeconds ?? params.ttlSeconds} || ' seconds')::interval`,
    })
    .returning({id: reservations.id});
  if (!reservation) throw new Error('Insert returned no rows');
  await bindIdleRunnerInstancesTx(tx, {
    provisionerId: params.provisionerId,
    reservationId: reservation.id,
    workspaceId: params.workspaceId,
    requiredLabels: demand.requiredLabels,
    scope: params.scope,
    ...(params.placement ? {placement: params.placement} : {}),
    idleRunners,
  });
}

async function insertLaunchReservationTx(
  tx: Tx,
  params: PollDemandAndReserveLockedParams,
  demand: DemandRow,
  launchCount: number,
): Promise<{id: string; expiresAt: Date} | undefined> {
  if (launchCount === 0) return undefined;
  const [inserted] = await tx
    .insert(reservations)
    .values({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      requiredLabels: demand.requiredLabels,
      count: launchCount,
      kind: 'launch',
      expiresAt: sql`now() + (${params.ttlSeconds} || ' seconds')::interval`,
    })
    .returning({id: reservations.id, expiresAt: reservations.expiresAt});
  if (!inserted) throw new Error('Insert returned no rows');
  return inserted;
}

async function listActiveProvisionerReservationRowsTx(
  tx: Tx,
  params: {workspaceId?: string; provisionerId?: string; lockForMutation?: boolean},
): Promise<ActiveProvisionerReservationRow[]> {
  const lockForMutation = params.lockForMutation ?? true;
  const candidateRows = await tx
    .select({id: reservations.id, provisionerId: reservations.provisionerId})
    .from(reservations)
    .where(
      and(
        params.workspaceId ? eq(reservations.workspaceId, params.workspaceId) : undefined,
        params.provisionerId ? eq(reservations.provisionerId, params.provisionerId) : undefined,
        gt(reservations.expiresAt, sql`now()`),
      ),
    );
  const candidateIds = candidateRows.map((row) => row.id);
  if (candidateIds.length === 0) return [];

  if (lockForMutation) await lockActiveReservationCandidates(tx, candidateRows);

  const activeRowsQuery = tx
    .select({
      id: reservations.id,
      provisionerId: reservations.provisionerId,
      requiredLabels: reservations.requiredLabels,
      count: reservations.count,
    })
    .from(reservations)
    .where(
      and(
        params.workspaceId ? eq(reservations.workspaceId, params.workspaceId) : undefined,
        params.provisionerId ? eq(reservations.provisionerId, params.provisionerId) : undefined,
        gt(reservations.expiresAt, sql`now()`),
      ),
    )
    .orderBy(asc(reservations.provisionerId), asc(reservations.id));
  // Metrics use a point-in-time read and must not contend with scheduling mutations.
  const activeRows = await (lockForMutation ? activeRowsQuery.for('update') : activeRowsQuery);
  if (activeRows.length === 0) return [];

  const activeIds = activeRows.map((row) => row.id);
  const activeIdSet = new Set(activeIds);
  const provisionerIds = [...new Set(activeRows.map((row) => row.provisionerId))];
  const linkedRunnerRows = await tx
    .select({
      id: providerRunners.id,
      firstClaimedAt: providerRunners.firstClaimedAt,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      reservationReleasedAt: providerRunners.reservationReleasedAt,
      state: providerRunners.state,
    })
    .from(providerRunners)
    .where(
      and(
        inArray(providerRunners.provisionerId, provisionerIds),
        or(
          inArray(providerRunners.reservationId, activeIds),
          inArray(providerRunners.intendedReservationId, activeIds),
        ),
      ),
    );
  const unclaimedByReservation = indexUnclaimedRunnersByReservation(linkedRunnerRows, activeIdSet);

  return activeRows.map((reservation) => {
    const unclaimed = unclaimedByReservation.get(reservation.id)?.size ?? 0;
    return {
      provisionerId: reservation.provisionerId,
      requiredLabels: reservation.requiredLabels,
      reserved: Math.min(reservation.count, unclaimed),
      leaked: Math.max(0, reservation.count - unclaimed),
    };
  });
}

async function lockActiveReservationCandidates(
  tx: Tx,
  rows: readonly {id: string; provisionerId: string}[],
): Promise<void> {
  const idsByProvisioner = new Map<string, string[]>();
  for (const row of rows) {
    const ids = idsByProvisioner.get(row.provisionerId) ?? [];
    ids.push(row.id);
    idsByProvisioner.set(row.provisionerId, ids);
  }
  for (const provisionerId of [...idsByProvisioner.keys()].sort()) {
    await lockRunnerReservationAdvisoryKeysTx(tx, {
      provisionerId,
      reservationIds: idsByProvisioner.get(provisionerId) ?? [],
    });
  }
}

function indexUnclaimedRunnersByReservation(
  runners: readonly {
    id: string;
    firstClaimedAt: Date | null;
    reservationId: string | null;
    intendedReservationId: string | null;
    reservationReleasedAt: Date | null;
    state: (typeof providerRunners.$inferSelect)['state'];
  }[],
  activeIds: ReadonlySet<string>,
): Map<string, Set<string>> {
  const unclaimed = new Map<string, Set<string>>();
  for (const runner of runners) {
    if (!runnerIsUnclaimed(runner)) continue;
    addActiveReservationRunner(unclaimed, activeIds, runner.reservationId, runner.id);
    addActiveReservationRunner(unclaimed, activeIds, runner.intendedReservationId, runner.id);
  }
  return unclaimed;
}

function runnerIsUnclaimed(runner: {
  firstClaimedAt: Date | null;
  reservationReleasedAt: Date | null;
  state: (typeof providerRunners.$inferSelect)['state'];
}): boolean {
  if (runner.firstClaimedAt !== null || runner.reservationReleasedAt !== null) return false;
  return !terminalStates.some((state) => state === runner.state);
}

function addActiveReservationRunner(
  target: Map<string, Set<string>>,
  activeIds: ReadonlySet<string>,
  reservationId: string | null,
  runnerId: string,
): void {
  if (reservationId === null || !activeIds.has(reservationId)) return;
  addUsedRunner(target, reservationId, runnerId);
}

export async function countLiveReservationLeakUnits(): Promise<number> {
  return await db().transaction(
    async (tx) => {
      const rows = await listActiveProvisionerReservationRowsTx(tx, {lockForMutation: false});
      return rows.reduce((total, row) => total + row.leaked, 0);
    },
    {isolationLevel: 'repeatable read', accessMode: 'read only'},
  );
}

function addUsedRunner(
  usedByReservation: Map<string, Set<string>>,
  reservationId: string,
  runnerId: string,
): void {
  const runnerIds = usedByReservation.get(reservationId);
  if (runnerIds) runnerIds.add(runnerId);
  else usedByReservation.set(reservationId, new Set([runnerId]));
}

// An expired or missing reservation is stale. A live reservation protects a runner that is
// still booting or waiting for its activation grace period.
function canBindRunner(tx: Tx, params: BindableRunnerParams) {
  return and(
    or(
      and(isNull(providerRunners.workspaceId), isNull(providerRunners.reservationId)),
      and(
        isNotNull(providerRunners.reservationId),
        params.scope === 'installation'
          ? undefined
          : or(
              isNull(providerRunners.workspaceId),
              eq(providerRunners.workspaceId, params.workspaceId),
            ),
        notExists(
          tx
            .select({id: reservations.id})
            .from(reservations)
            .where(
              and(
                eq(reservations.id, providerRunners.reservationId),
                gt(reservations.expiresAt, sql`now()`),
              ),
            ),
        ),
      ),
    ),
    or(
      isNull(providerRunners.intendedReservationId),
      notExists(
        tx
          .select({id: reservations.id})
          .from(reservations)
          .where(
            and(
              eq(reservations.id, providerRunners.intendedReservationId),
              gt(reservations.expiresAt, sql`now()`),
            ),
          ),
      ),
    ),
    isNull(providerRunners.reservationReleasedAt),
    isNull(providerRunners.runnerSessionId),
  );
}

function isBindableRunner(tx: Tx, params: BindableRunnerParams) {
  return and(
    eq(providerRunners.provisionerId, params.provisionerId),
    canBindRunner(tx, params),
    isNotNull(providerRunners.providerRunnerId),
    eq(providerRunners.state, 'running'),
    arrayContains(providerRunners.labels, params.requiredLabels),
    ...(params.refusedTemplateLabels ?? []).map((labels) =>
      not(arrayContains(providerRunners.labels, labels)),
    ),
    exists(
      tx
        .select({id: runnerControlSessions.id})
        .from(runnerControlSessions)
        .where(
          and(
            eq(runnerControlSessions.runnerInstanceId, providerRunners.id),
            eq(runnerControlSessions.provisionerId, params.provisionerId),
            isNull(runnerControlSessions.closedAt),
            gt(runnerControlSessions.expiresAt, sql`now()`),
          ),
        ),
    ),
  );
}

async function listIdleRunnerInstancesTx(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number},
): Promise<IdleRunnerCandidate[]> {
  const lockedRunners = await selectIdleRunnerInstancesTx(tx, params);
  if (lockedRunners.length === 0) return lockedRunners;

  // A SELECT ... FOR UPDATE can wake with a fresh target row but the original
  // statement snapshot for reservation subqueries. Re-check the full predicate
  // in a new statement while retaining the row locks from the first query.
  return await selectIdleRunnerInstancesTx(tx, {
    ...params,
    runnerIds: lockedRunners.map((runner) => runner.id),
    count: lockedRunners.length,
  });
}

async function listCapacityIdleRunnerInstancesTx(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number},
): Promise<CapacityIdleRunnerCandidate[]> {
  const idleRunners = await listIdleRunnerInstancesTx(tx, params);
  if (idleRunners.length === 0) return [];
  const holdRows = await tx
    .select({
      runnerInstanceId: capacityHolds.runnerInstanceId,
      workspaceId: capacityHolds.workspaceId,
      units: capacityHolds.units,
    })
    .from(capacityHolds)
    .where(
      and(
        inArray(
          capacityHolds.runnerInstanceId,
          idleRunners.map((runner) => runner.id),
        ),
        isNull(capacityHolds.releasedAt),
      ),
    );
  const holdsByRunner = new Map<string, {workspaceId: string; units: number}>();
  for (const hold of holdRows) {
    if (hold.runnerInstanceId)
      holdsByRunner.set(hold.runnerInstanceId, {
        workspaceId: hold.workspaceId,
        units: hold.units,
      });
  }
  return idleRunners.map((runner) => ({
    ...runner,
    capacityHold: holdsByRunner.get(runner.id),
  }));
}

async function selectIdleRunnerInstancesTx(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number; runnerIds?: string[]},
): Promise<IdleRunnerCandidate[]> {
  if (params.runnerIds) {
    // The first pass retains the row locks. Recheck the full predicate in a fresh statement so
    // reservation subqueries see the state that was current when the lock was acquired.
    return await tx
      .select({
        id: providerRunners.id,
        launchKind: providerRunners.launchKind,
        labels: providerRunners.labels,
      })
      .from(providerRunners)
      .where(and(inArray(providerRunners.id, params.runnerIds), isBindableRunner(tx, params)))
      .orderBy(asc(providerRunners.createdAt), asc(providerRunners.id))
      .limit(params.count);
  }

  // Select the oldest candidates first, but leave row locking to a second pass. The cleanup
  // path locks runner rows by id, so the locking pass must use that same order. A skipped row
  // rolls back only this nested savepoint and retries the bounded candidate scan, allowing the
  // next-oldest eligible runner to refill the grant without retaining a partial lock set.
  return lockIdleRunnerCandidatesWithRetry(tx, params);
}

async function lockIdleRunnerCandidatesWithRetry(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number},
): Promise<IdleRunnerCandidate[]> {
  const retrySelection = Symbol('retry bindable runner selection');
  while (true) {
    try {
      return await tx.transaction((lockTx) =>
        lockIdleRunnerCandidateBatch(lockTx, params, retrySelection),
      );
    } catch (error) {
      if (error !== retrySelection) throw error;
    }
  }
}

async function lockIdleRunnerCandidateBatch(
  tx: Tx,
  params: IdleRunnerSelectionParams & {count: number},
  retrySelection: symbol,
): Promise<IdleRunnerCandidate[]> {
  const candidateRunners = await tx
    .select({
      id: providerRunners.id,
      launchKind: providerRunners.launchKind,
      labels: providerRunners.labels,
    })
    .from(providerRunners)
    .where(isBindableRunner(tx, params))
    .orderBy(asc(providerRunners.createdAt), asc(providerRunners.id))
    .limit(params.count);
  if (candidateRunners.length === 0) return candidateRunners;

  const lockedRunners: typeof candidateRunners = [];
  for (const candidate of [...candidateRunners].sort(compareRunnerIds)) {
    const [runner] = await tx
      .select({
        id: providerRunners.id,
        launchKind: providerRunners.launchKind,
        labels: providerRunners.labels,
      })
      .from(providerRunners)
      .where(and(eq(providerRunners.id, candidate.id), isBindableRunner(tx, params)))
      .for('update');
    if (runner) lockedRunners.push(runner);
  }
  if (lockedRunners.length !== candidateRunners.length) throw retrySelection;
  return lockedRunners;
}

async function bindIdleRunnerInstancesTx(
  tx: Tx,
  params: {
    provisionerId: string;
    reservationId: string;
    workspaceId: string;
    requiredLabels: string[];
    scope: DemandScope;
    placement?: InstallationPlacementPolicy;
    idleRunners: IdleRunnerCandidate[];
  },
): Promise<void> {
  const idleRunnerIds = params.idleRunners.map((runner) => runner.id);

  if (params.scope === 'installation' && params.placement) {
    for (const runner of params.idleRunners) {
      await assignRunnerCapacityHoldTx(tx, {
        workspaceId: params.workspaceId,
        runnerInstanceId: runner.id,
        units: params.placement.units(runner.labels),
      });
    }
  }

  await tx
    .update(runnerActivationTokens)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        inArray(runnerActivationTokens.runnerInstanceId, idleRunnerIds),
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
      ),
    );

  // listIdleRunnerInstancesTx re-checks the full eligibility predicate in a fresh statement
  // after acquiring row locks. Those locks prevent the validated set from changing before this
  // update runs.
  const boundRunners = await tx
    .update(providerRunners)
    .set({
      workspaceId: params.workspaceId,
      reservationId: params.reservationId,
      intendedReservationId: null,
      assignedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(inArray(providerRunners.id, idleRunnerIds), isBindableRunner(tx, params)))
    .returning({id: providerRunners.id, launchKind: providerRunners.launchKind});

  if (boundRunners.length !== params.idleRunners.length)
    throw new Error('Locked idle runner set changed before binding');

  const reboundCount = boundRunners.filter((runner) => runner.launchKind === 'demand').length;
  if (reboundCount > 0)
    recordProviderRunnerActivationOutcome({outcome: 'rebound', count: reboundCount});
}

async function listInstallationDemandWorkspaceIds(eligibleWorkspaceIds: ReadonlySet<string>) {
  if (eligibleWorkspaceIds.size === 0) return [];
  const rows = await db()
    .select({
      workspaceId: pendingJobExecutions.workspaceId,
      oldestQueuedAt: sql<Date>`min(${pendingJobExecutions.createdAt})`,
    })
    .from(pendingJobExecutions)
    .where(inArray(pendingJobExecutions.workspaceId, [...eligibleWorkspaceIds]))
    .groupBy(pendingJobExecutions.workspaceId)
    .orderBy(
      asc(sql`min(${pendingJobExecutions.createdAt})`),
      asc(pendingJobExecutions.workspaceId),
    );
  return rows.map((row) => row.workspaceId);
}

export async function listQueuedDemandWorkspaceIds(): Promise<string[]> {
  const rows = await db()
    .select({workspaceId: pendingJobExecutions.workspaceId})
    .from(pendingJobExecutions)
    .groupBy(pendingJobExecutions.workspaceId);
  return rows.map((row) => row.workspaceId);
}

async function listActiveWorkspaceCapabilityLabelsTx(
  tx: Tx,
  params: {workspaceId: string; windowSeconds: number},
): Promise<string[][]> {
  const rows = await tx
    .select({labels: provisionerCapabilitySnapshots.labels})
    .from(provisionerCapabilitySnapshots)
    .innerJoin(
      provisionerTokens,
      eq(provisionerTokens.id, provisionerCapabilitySnapshots.provisionerId),
    )
    .where(
      and(
        eq(provisionerCapabilitySnapshots.workspaceId, params.workspaceId),
        eq(provisionerTokens.workspaceId, params.workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
        sql`${provisionerCapabilitySnapshots.advertisedAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
        sql`${provisionerTokens.revokedAt} is null`,
        sql`(${provisionerTokens.expiresAt} is null or ${provisionerTokens.expiresAt} > now())`,
      ),
    );
  return rows.map((row) => row.labels);
}

export async function deleteExpiredReservations(params?: {limit?: number}): Promise<number> {
  return await db().transaction(async (tx) => {
    const expiredRows = await tx
      .select({id: reservations.id})
      .from(reservations)
      .where(lt(reservations.expiresAt, sql`now()`))
      .orderBy(asc(reservations.expiresAt))
      .limit(params?.limit ?? 1000);
    return await deleteReservationsWithCleanupTx(
      tx,
      expiredRows.map((reservation) => reservation.id),
      {expiredOnly: true},
    );
  });
}

export async function deleteReservationsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  return await db().transaction(async (tx) => {
    return await deleteReservationsWithCleanupTx(tx, ids);
  });
}

async function deleteReservationsWithCleanupTx(
  tx: Tx,
  ids: string[],
  params: {expiredOnly?: boolean} = {},
): Promise<number> {
  if (ids.length === 0) return 0;

  const isAffectedRunner = () =>
    or(
      and(
        inArray(providerRunners.reservationId, ids),
        isNull(providerRunners.runnerSessionId),
        isNull(providerRunners.reservationReleasedAt),
      ),
      inArray(providerRunners.intendedReservationId, ids),
    );
  const candidateRunners = await tx
    .select({
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      runnerSessionId: providerRunners.runnerSessionId,
      reservationReleasedAt: providerRunners.reservationReleasedAt,
    })
    .from(providerRunners)
    .where(isAffectedRunner())
    .orderBy(asc(providerRunners.id));
  const affectedRunners: typeof candidateRunners = [];
  for (const candidate of [...candidateRunners].sort(compareRunnerIds)) {
    const [runner] = await tx
      .select({
        id: providerRunners.id,
        reservationId: providerRunners.reservationId,
        intendedReservationId: providerRunners.intendedReservationId,
        runnerSessionId: providerRunners.runnerSessionId,
        reservationReleasedAt: providerRunners.reservationReleasedAt,
      })
      .from(providerRunners)
      .where(and(eq(providerRunners.id, candidate.id), isAffectedRunner()))
      .for('update');
    if (runner) affectedRunners.push(runner);
  }
  const reservationRows = await tx
    .select({id: reservations.id})
    .from(reservations)
    .where(
      and(
        inArray(reservations.id, ids),
        params.expiredOnly ? lt(reservations.expiresAt, sql`now()`) : undefined,
      ),
    )
    .for('update');
  const reservationIds = reservationRows.map((reservation) => reservation.id);

  if (reservationIds.length === 0) return 0;
  await releaseUnboundCapacityHoldsForReservationsTx(tx, reservationIds);

  const assignedRunnerIds = affectedRunners
    .filter(
      (runner) =>
        runner.reservationId &&
        reservationIds.includes(runner.reservationId) &&
        !runner.runnerSessionId &&
        !runner.reservationReleasedAt,
    )
    .map((runner) => runner.id);
  const intendedRunnerIds = affectedRunners
    .filter(
      (runner) =>
        runner.intendedReservationId && reservationIds.includes(runner.intendedReservationId),
    )
    .map((runner) => runner.id);
  if (assignedRunnerIds.length > 0) {
    await tx
      .update(runnerActivationTokens)
      .set({revokedAt: sql`now()`})
      .where(
        and(
          inArray(runnerActivationTokens.runnerInstanceId, assignedRunnerIds),
          isNull(runnerActivationTokens.consumedAt),
          isNull(runnerActivationTokens.revokedAt),
        ),
      );
    await tx
      .update(providerRunners)
      .set({
        workspaceId: null,
        reservationId: null,
        assignedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(providerRunners.id, assignedRunnerIds),
          isNull(providerRunners.runnerSessionId),
          isNull(providerRunners.reservationReleasedAt),
        ),
      );
  }
  if (intendedRunnerIds.length > 0) {
    await tx
      .update(providerRunners)
      .set({intendedReservationId: null, updatedAt: sql`now()`})
      .where(
        and(
          inArray(providerRunners.id, intendedRunnerIds),
          inArray(providerRunners.intendedReservationId, reservationIds),
        ),
      );
  }

  const deleted = await tx
    .delete(reservations)
    .where(inArray(reservations.id, reservationIds))
    .returning({id: reservations.id});

  return deleted.length;
}

export async function releaseReservationUnits(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    releases: Array<{reservationId: string; count: number}>;
  },
): Promise<number> {
  const releaseByReservationId = new Map<string, number>();
  for (const release of params.releases) {
    if (release.count <= 0) continue;
    releaseByReservationId.set(
      release.reservationId,
      (releaseByReservationId.get(release.reservationId) ?? 0) + release.count,
    );
  }
  const reservationIds = [...releaseByReservationId.keys()];
  if (reservationIds.length === 0) return 0;

  const releaseCount = sql<number>`CASE ${reservations.id}
    ${sql.join(
      [...releaseByReservationId].map(
        ([reservationId, count]) => sql`WHEN ${reservationId} THEN ${count}`,
      ),
      sql` `,
    )}
    ELSE 0
  END`;
  const scope = and(
    eq(reservations.workspaceId, params.workspaceId),
    eq(reservations.provisionerId, params.provisionerId),
    inArray(reservations.id, reservationIds),
    gt(reservations.expiresAt, sql`now()`),
  );

  const decremented = await tx
    .update(reservations)
    .set({count: sql`${reservations.count} - ${releaseCount}`})
    .where(and(scope, gt(reservations.count, releaseCount)))
    .returning({id: reservations.id});
  const releasedFromDecremented = decremented.reduce(
    (total, row) => total + (releaseByReservationId.get(row.id) ?? 0),
    0,
  );

  const decrementedIds = decremented.map((row) => row.id);
  const deleted = await tx
    .delete(reservations)
    .where(
      and(
        scope,
        sql`${reservations.count} <= ${releaseCount}`,
        decrementedIds.length > 0 ? notInArray(reservations.id, decrementedIds) : undefined,
      ),
    )
    .returning({count: reservations.count});
  const releasedFromDeleted = deleted.reduce((total, row) => total + row.count, 0);

  return releasedFromDeleted + releasedFromDecremented;
}

interface ReleaseTerminalRunnerReservationsParams {
  workspaceId: string | null;
  provisionerId: string;
  providerRunnerIds?: string[];
  runnerInstanceIds?: string[];
  reportedAtByProviderRunnerId?: ReadonlyMap<string, Date>;
  requireUnlinkedSession?: boolean;
  /** Lock linked runners before rechecking terminal state for lease finalization. */
  requireTerminalState?: boolean;
}

export async function releaseTerminalRunnerInstanceReservationsByIds(
  tx: Tx,
  params: ReleaseTerminalRunnerReservationsParams,
): Promise<number> {
  if (
    (params.providerRunnerIds?.length ?? 0) === 0 &&
    (params.runnerInstanceIds?.length ?? 0) === 0
  )
    return 0;

  const {
    reservationWorkspacePredicate,
    noUncancelledRunningJobPredicate,
    reportFreshnessPredicate,
    runnerIdentityPredicate,
  } = terminalReservationReleasePredicates(tx, params);

  // Assignment locks these keys before changing runner links. Acquire them before locking or
  // marking terminal runners so an assignment cannot consume a reservation concurrently with
  // this release.
  const reservationRowsToLock = await tx
    .select({
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        runnerIdentityPredicate,
        params.requireTerminalState === false
          ? undefined
          : inArray(providerRunners.state, terminalStates),
        or(
          isNotNull(providerRunners.reservationId),
          isNotNull(providerRunners.intendedReservationId),
        ),
        isNull(providerRunners.reservationReleasedAt),
      ),
    );
  const reservationIdsToLock = [
    ...new Set(
      reservationRowsToLock.flatMap((row) =>
        [row.reservationId, row.intendedReservationId].filter(
          (reservationId): reservationId is string => reservationId !== null,
        ),
      ),
    ),
  ];
  await lockRunnerReservationAdvisoryKeysTx(tx, {
    provisionerId: params.provisionerId,
    reservationIds: reservationIdsToLock,
  });

  const rows = await tx
    .select({
      id: providerRunners.id,
      state: providerRunners.state,
      releaseReservationId: sql<string | null>`coalesce(
        (select ${reservations.id}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.intendedReservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate}),
        (select ${reservations.id}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.reservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate})
      )`,
      releaseReservationWorkspaceId: sql<string | null>`coalesce(
        (select ${reservations.workspaceId}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.intendedReservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate}),
        (select ${reservations.workspaceId}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.reservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}
           ${reservationWorkspacePredicate})
      )`,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        runnerIdentityPredicate,
        params.requireTerminalState === false
          ? undefined
          : inArray(providerRunners.state, terminalStates),
        or(
          isNotNull(providerRunners.reservationId),
          isNotNull(providerRunners.intendedReservationId),
        ),
        params.workspaceId === null
          ? undefined
          : or(
              and(
                eq(providerRunners.workspaceId, params.workspaceId),
                or(
                  exists(
                    tx
                      .select({id: reservations.id})
                      .from(reservations)
                      .where(
                        and(
                          eq(reservations.workspaceId, params.workspaceId),
                          eq(reservations.provisionerId, params.provisionerId),
                          eq(reservations.id, providerRunners.reservationId),
                        ),
                      ),
                  ),
                  exists(
                    tx
                      .select({id: reservations.id})
                      .from(reservations)
                      .where(
                        and(
                          eq(reservations.workspaceId, params.workspaceId),
                          eq(reservations.provisionerId, params.provisionerId),
                          eq(reservations.id, providerRunners.intendedReservationId),
                        ),
                      ),
                  ),
                ),
              ),
              and(
                isNull(providerRunners.workspaceId),
                isNotNull(providerRunners.intendedReservationId),
                exists(
                  tx
                    .select({id: reservations.id})
                    .from(reservations)
                    .where(
                      and(
                        eq(reservations.workspaceId, params.workspaceId),
                        eq(reservations.provisionerId, params.provisionerId),
                        eq(reservations.id, providerRunners.intendedReservationId),
                      ),
                    ),
                ),
              ),
            ),
        params.requireUnlinkedSession === false
          ? undefined
          : isNull(providerRunners.runnerSessionId),
        noUncancelledRunningJobPredicate,
        reportFreshnessPredicate,
        isNull(providerRunners.reservationReleasedAt),
      ),
    )
    .for('update');

  if (rows.length === 0) return 0;

  // The lease-finalization path deliberately locks active rows too. If a terminal report is
  // concurrently projecting the runner state, PostgreSQL rechecks this row after the lock and
  // lets cleanup observe the committed terminal state without a cross-module advisory lock.
  const terminalRows = terminalReservationReleaseRows(rows, params.requireTerminalState);
  if (terminalRows.length === 0) return 0;

  const updated = await tx
    .update(providerRunners)
    .set({
      intendedReservationId: null,
      reservationReleasedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(
          providerRunners.id,
          terminalRows.map((row) => row.id),
        ),
        params.requireUnlinkedSession === false
          ? undefined
          : isNull(providerRunners.runnerSessionId),
        noUncancelledRunningJobPredicate,
        reportFreshnessPredicate,
        isNull(providerRunners.reservationReleasedAt),
      ),
    )
    .returning({id: providerRunners.id});

  return releaseUpdatedRunnerReservationsTx(tx, params.provisionerId, terminalRows, updated);
}

function terminalReservationReleasePredicates(
  tx: Tx,
  params: ReleaseTerminalRunnerReservationsParams,
) {
  const reservationWorkspacePredicate =
    params.workspaceId === null
      ? sql``
      : sql`and ${eq(reservations.workspaceId, params.workspaceId)}`;
  const noUncancelledRunningJobPredicate = notExists(
    tx
      .select({id: runningJobExecutions.id})
      .from(runningJobExecutions)
      .where(
        and(
          eq(runningJobExecutions.provisionerId, params.provisionerId),
          eq(runningJobExecutions.providerRunnerId, providerRunners.providerRunnerId),
          isNull(runningJobExecutions.cancellationRequestedAt),
          params.workspaceId === null
            ? undefined
            : eq(runningJobExecutions.workspaceId, params.workspaceId),
        ),
      ),
  );
  const reportFreshnessPredicate =
    params.reportedAtByProviderRunnerId && params.reportedAtByProviderRunnerId.size > 0
      ? or(
          ...[...params.reportedAtByProviderRunnerId].map(([providerRunnerId, reportedAt]) =>
            and(
              eq(providerRunners.providerRunnerId, providerRunnerId),
              lte(providerRunners.reportedAt, reportedAt),
            ),
          ),
        )
      : undefined;
  const runnerIdentityPredicate = or(
    params.providerRunnerIds && params.providerRunnerIds.length > 0
      ? inArray(providerRunners.providerRunnerId, params.providerRunnerIds)
      : undefined,
    params.runnerInstanceIds && params.runnerInstanceIds.length > 0
      ? inArray(providerRunners.id, params.runnerInstanceIds)
      : undefined,
  );
  return {
    reservationWorkspacePredicate,
    noUncancelledRunningJobPredicate,
    reportFreshnessPredicate,
    runnerIdentityPredicate,
  };
}

type TerminalReservationReleaseRow = {
  id: string;
  state: (typeof providerRunners.$inferSelect)['state'];
  releaseReservationId: string | null;
  releaseReservationWorkspaceId: string | null;
};

function terminalReservationReleaseRows(
  rows: readonly TerminalReservationReleaseRow[],
  requireTerminalState: boolean | undefined,
): readonly TerminalReservationReleaseRow[] {
  if (requireTerminalState !== false) return rows;
  return rows.filter((row) => terminalStates.some((terminalState) => terminalState === row.state));
}

async function releaseUpdatedRunnerReservationsTx(
  tx: Tx,
  provisionerId: string,
  terminalRows: readonly TerminalReservationReleaseRow[],
  updated: readonly {id: string}[],
): Promise<number> {
  const releasesByReservation = groupRunnerReservationReleases(terminalRows, updated);
  const releasesByWorkspace = groupReservationReleasesByWorkspace(releasesByReservation.values());
  let released = 0;
  for (const [workspaceId, releases] of releasesByWorkspace) {
    released += await releaseReservationUnits(tx, {workspaceId, provisionerId, releases});
  }
  return released;
}

function groupRunnerReservationReleases(
  rows: readonly TerminalReservationReleaseRow[],
  updated: readonly {id: string}[],
): Map<string, {workspaceId: string; reservationId: string; count: number}> {
  const releases = new Map<string, {workspaceId: string; reservationId: string; count: number}>();
  const updatedIds = new Set(updated.map((row) => row.id));
  for (const row of rows) {
    if (!updatedIds.has(row.id)) continue;
    if (!row.releaseReservationId || !row.releaseReservationWorkspaceId) continue;
    const key = `${row.releaseReservationWorkspaceId}:${row.releaseReservationId}`;
    const release = releases.get(key) ?? {
      workspaceId: row.releaseReservationWorkspaceId,
      reservationId: row.releaseReservationId,
      count: 0,
    };
    release.count += 1;
    releases.set(key, release);
  }
  return releases;
}

function groupReservationReleasesByWorkspace(
  releases: Iterable<{workspaceId: string; reservationId: string; count: number}>,
): Map<string, Array<{reservationId: string; count: number}>> {
  const grouped = new Map<string, Array<{reservationId: string; count: number}>>();
  for (const release of releases) {
    const workspaceReleases = grouped.get(release.workspaceId) ?? [];
    workspaceReleases.push({reservationId: release.reservationId, count: release.count});
    grouped.set(release.workspaceId, workspaceReleases);
  }
  return grouped;
}

function deductProvisionerReservations(
  templates: NormalizedTemplate[],
  activeReservations: {requiredLabels: string[]; reserved: number}[],
  placement: InstallationPlacementPolicy | undefined,
): void {
  for (const reservation of sortReservationRows(activeReservations)) {
    drawSlots(
      orderSatisfyingTemplates(templates, reservation.requiredLabels, placement),
      reservation.reserved,
    );
  }
}

function compareRunnerIds(left: {id: string}, right: {id: string}): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function sortDemandRows(rows: DemandRow[]): DemandRow[] {
  return [...rows].sort((a, b) => {
    const specificity = b.requiredLabels.length - a.requiredLabels.length;
    if (specificity !== 0) return specificity;
    return a.oldestQueuedAt.getTime() - b.oldestQueuedAt.getTime();
  });
}

function sortReservationRows<T extends {requiredLabels: string[]}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const specificity = b.requiredLabels.length - a.requiredLabels.length;
    if (specificity !== 0) return specificity;
    return labelKey(a.requiredLabels).localeCompare(labelKey(b.requiredLabels));
  });
}

function isSubset(requiredLabels: string[], availableLabels: string[]): boolean {
  return requiredLabels.every((label) => availableLabels.includes(label));
}

function isCoveredByWorkspaceCapability(
  requiredLabels: string[],
  capabilityLabels: readonly string[][],
): boolean {
  return capabilityLabels.some((labels) => isSubset(requiredLabels, labels));
}

type TemplateOrder = InstallationPlacementPolicy['templateOrder'];

function capacityTemplatesForJob(
  state: DemandReservationState,
  rules: WorkspacePlacementRules & {capacityUnits: number},
  requiredLabels: string[],
  placement: InstallationPlacementPolicy | undefined,
): NormalizedTemplate[] {
  return orderSatisfyingTemplates(
    allowedByRules(state.templates, rules),
    requiredLabels,
    placement,
  );
}

function orderSatisfyingTemplates(
  templates: readonly NormalizedTemplate[],
  requiredLabels: string[],
  placement: InstallationPlacementPolicy | undefined,
  order: TemplateOrder = placement?.templateOrder ?? 'default',
): NormalizedTemplate[] {
  return templates
    .filter((template) => isSubset(requiredLabels, template.labels))
    .sort((a, b) => {
      if (order === 'smallest' && placement) {
        const units = placement.units(a.labels) - placement.units(b.labels);
        if (units !== 0) return units;
      }
      return a.labels.length - b.labels.length || a.templateKey.localeCompare(b.templateKey);
    });
}

function drawSlots(templates: NormalizedTemplate[], count: number): void {
  let remaining = count;
  for (const template of templates) {
    if (remaining === 0) return;
    const used = Math.min(template.remainingSlots, remaining);
    template.remainingSlots -= used;
    remaining -= used;
  }
}

function labelKey(labels: string[]): string {
  return JSON.stringify(labels);
}

function capacityDeltaForIdleRunner(
  runner: CapacityIdleRunnerCandidate,
  workspaceId: string,
  placement: InstallationPlacementPolicy | undefined,
): number {
  const units = placement?.units(runner.labels) ?? 0;
  if (runner.capacityHold?.workspaceId !== workspaceId) return units;
  return units - runner.capacityHold.units;
}

function allocateLaunchUnits(
  templates: readonly NormalizedTemplate[],
  count: number,
  placement: InstallationPlacementPolicy,
): number[] {
  let remaining = count;
  const units: number[] = [];
  for (const template of templates) {
    const take = Math.min(remaining, template.remainingSlots);
    for (let index = 0; index < take; index += 1) units.push(placement.units(template.labels));
    remaining -= take;
    if (remaining === 0) break;
  }
  return units;
}

function countChangedTemplates(
  satisfyingTemplates: readonly NormalizedTemplate[],
  count: number,
  placement: InstallationPlacementPolicy,
): void {
  if (count === 0) return;
  const defaultKeys = drawnTemplateKeys(
    orderSatisfyingTemplates(satisfyingTemplates, [], placement, 'default'),
    count,
  );
  const smallestKeys = drawnTemplateKeys(
    orderSatisfyingTemplates(satisfyingTemplates, [], placement, 'smallest'),
    count,
  );
  const changed = defaultKeys.filter((key, index) => key !== smallestKeys[index]).length;
  recordPlacementTemplateChanged({order: placement.templateOrder, count: changed});
}

function drawnTemplateKeys(templates: readonly NormalizedTemplate[], count: number): string[] {
  const keys: string[] = [];
  for (const template of templates) {
    const take = Math.min(count - keys.length, template.remainingSlots);
    for (let index = 0; index < take; index += 1) keys.push(template.templateKey);
  }
  return keys;
}

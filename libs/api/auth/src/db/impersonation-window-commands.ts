import type {AdminRole, ImpersonationWindowState} from '@shipfox/api-auth-dto';
import {
  type AdministrationActionEvent,
  type AdministrationActionResult,
  createAdministrationActionEvent,
} from '@shipfox/api-common-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull} from 'drizzle-orm';
import {hasMinimumAdminRole, highestAdminRole} from '#core/admin-role-model.js';
import {
  createImpersonatedSessionTokenFromClaims,
  impersonationTtlSeconds,
  loadWorkspaceWindowMembership,
} from '#core/auth.js';
import type {ImpersonationWindow} from '#core/entities/impersonation-window.js';
import type {User} from '#core/entities/user.js';
import {
  AdminIdempotencyKeyReuseError,
  AdminRoleRequiredError,
  ImpersonationDisabledError,
  ImpersonationExpiredError,
  ImpersonationWindowDeadlineReachedError,
  ImpersonationWindowLimitReachedError,
  ImpersonationWindowNotFoundError,
  ImpersonationWindowStoppedError,
  ImpersonationWorkspaceNotActiveError,
  UserNotFoundError,
} from '#core/errors.js';
import type {TokenMembership} from '#core/jwt.js';
import {recordImpersonationAuditWriteFailure} from '#metrics/index.js';
import {
  findAdminCommandResult,
  lockAdminCommand,
  lockAdminOwnerGrants,
  lockImpersonationWindowActor,
  storeAdminCommandResult,
  type Tx,
  updateAdminCommandResult,
  writeAdminAction,
} from './admin-command.js';
import {requireActiveAdminOperator} from './admin-user-moderation.js';
import {db} from './db.js';
import {
  createImpersonationWindow,
  findImpersonationWindow,
  materializeImpersonationWindowExpiry,
  requireImpersonationWindowCapacity,
  stopImpersonationWindow,
} from './impersonation-windows.js';
import type {
  StoredImpersonationWindowResult,
  StoredImpersonationWindowStopResult,
} from './schema/admin-command-results.js';
import {adminGrants} from './schema/admin-grants.js';
import {toUser, users} from './schema/users.js';

export const IMPERSONATION_WINDOW_START_COMMAND = 'auth.impersonation.window.start';
export const IMPERSONATION_WINDOW_CONTINUE_COMMAND = 'auth.impersonation.window.continue';
export const IMPERSONATION_WINDOW_STOP_COMMAND = 'auth.impersonation.window.stop';

const IMPERSONATION_REQUIRED_ROLE: AdminRole = 'admin-operator';
const IMPERSONATION_OWNER_ROLE: AdminRole = 'admin-owner';

type WindowMintCommand =
  | typeof IMPERSONATION_WINDOW_START_COMMAND
  | typeof IMPERSONATION_WINDOW_CONTINUE_COMMAND;

export interface ImpersonationWindowMintCommandParams {
  actorId: string;
  workspaceId: string;
  reason?: string | undefined;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  correlationId: string;
  workspaces: WorkspacesInterModuleClient;
  windowMaxSeconds: number;
}

export interface ImpersonationWindowContinueCommandParams {
  actorId: string;
  windowId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  correlationId: string;
  workspaces: WorkspacesInterModuleClient;
}

export interface ImpersonationWindowStopCommandParams {
  actorId: string;
  windowId: string;
  reason?: string | undefined;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  correlationId: string;
}

export interface ImpersonationWindowMintResult {
  token: string;
  expiresAt: Date;
  user: User;
  impersonatorId: string;
  workspaceId: string;
  windowId: string;
  windowStartedAt: Date;
  windowDeadline: Date;
  serverTime: Date;
}

export interface ImpersonationWindowStopResult {
  windowId: string;
  state: Extract<ImpersonationWindowState, 'stopped' | 'expired'>;
  endedAt: Date;
}

export interface ImpersonationWindowTerminalTransition {
  reason: 'stopped' | 'expired';
  startedAt: Date;
  endedAt: Date;
}

export type ImpersonationWindowCommandOutcome<T> =
  | {
      kind: 'success';
      result: T;
      terminalTransition?: ImpersonationWindowTerminalTransition;
      terminalTransitions?: ImpersonationWindowTerminalTransition[];
    }
  | {
      kind: 'failure';
      error: Error;
      terminalTransition?: ImpersonationWindowTerminalTransition;
      terminalTransitions?: ImpersonationWindowTerminalTransition[];
    };

interface AuditTarget {
  type: 'workspace' | 'user' | 'impersonation-window';
  id: string;
}

interface MintAuditContext {
  actorId: string;
  target: AuditTarget;
  reason: string | null;
  actorRole?: AdminRole | null | undefined;
  actorRoleAtStart?: AdminRole | undefined;
}

function mintEvent(params: {
  command: WindowMintCommand;
  context: MintAuditContext;
  result: AdministrationActionResult;
  idempotencyKeyFingerprint: string;
  correlationId: string;
  occurredAt: Date;
}): AdministrationActionEvent {
  const actorRole = params.context.actorRole ?? null;
  return createAdministrationActionEvent({
    actorId: params.context.actorId,
    authorizationBasis: actorRole ? 'current-role' : 'authorization-denied',
    actorRole,
    requiredRole: IMPERSONATION_REQUIRED_ROLE,
    ...(params.context.actorRoleAtStart === undefined
      ? {}
      : {actorRoleAtStart: params.context.actorRoleAtStart}),
    command: params.command,
    targetType: params.context.target.type,
    targetId: params.context.target.id,
    reason: params.context.reason,
    result: params.result,
    correlationId: params.correlationId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    occurredAt: params.occurredAt.toISOString(),
  });
}

function stopEvent(params: {
  actorId: string;
  windowId: string;
  actorRole: AdminRole | null;
  actorRoleAtStart: AdminRole;
  reason: string | null;
  idempotencyKeyFingerprint: string;
  correlationId: string;
  occurredAt: Date;
  owned: boolean;
}): AdministrationActionEvent {
  if (params.owned) {
    return createAdministrationActionEvent({
      actorId: params.actorId,
      authorizationBasis: 'impersonation-window-owner',
      actorRole: null,
      requiredRole: null,
      actorRoleAtStart: params.actorRoleAtStart,
      command: IMPERSONATION_WINDOW_STOP_COMMAND,
      targetType: 'impersonation-window',
      targetId: params.windowId,
      reason: params.reason,
      result: 'succeeded',
      correlationId: params.correlationId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      occurredAt: params.occurredAt.toISOString(),
    });
  }

  if (!params.actorRole) {
    throw new AdminRoleRequiredError(IMPERSONATION_OWNER_ROLE);
  }

  return createAdministrationActionEvent({
    actorId: params.actorId,
    authorizationBasis: 'current-role',
    actorRole: params.actorRole,
    requiredRole: IMPERSONATION_OWNER_ROLE,
    command: IMPERSONATION_WINDOW_STOP_COMMAND,
    targetType: 'impersonation-window',
    targetId: params.windowId,
    reason: params.reason,
    result: 'succeeded',
    correlationId: params.correlationId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    occurredAt: params.occurredAt.toISOString(),
  });
}

async function readCurrentAdminRole(tx: Tx, actorId: string): Promise<AdminRole | null> {
  const actorRows = await tx
    .select({status: users.status})
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);
  if (actorRows[0]?.status !== 'active') return null;

  const grantRows = await tx
    .select({role: adminGrants.role})
    .from(adminGrants)
    .where(and(eq(adminGrants.userId, actorId), isNull(adminGrants.revokedAt)));
  return highestAdminRole(grantRows.map(({role}) => role));
}

async function readActorUser(tx: Tx, actorId: string): Promise<User> {
  const rows = await tx.select().from(users).where(eq(users.id, actorId)).limit(1);
  const row = rows[0];
  if (!row || row.status === 'deleted') throw new UserNotFoundError(actorId);
  return toUser(row);
}

// Windows opened before they targeted a workspace audit against their user.
function windowAuditTarget(window: {
  id: string;
  workspaceId: string | null;
  targetUserId: string | null;
}): AuditTarget {
  if (window.workspaceId) return {type: 'workspace', id: window.workspaceId};
  if (window.targetUserId) return {type: 'user', id: window.targetUserId};
  return {type: 'impersonation-window', id: window.id};
}

function terminalTransition(window: {
  startedAt: Date;
  endedAt: Date | null;
  endedReason: 'stopped' | 'expired' | null;
}): ImpersonationWindowTerminalTransition | undefined {
  if (!window.endedAt || !window.endedReason) return undefined;
  return {
    reason: window.endedReason,
    startedAt: window.startedAt,
    endedAt: window.endedAt,
  };
}

function tokenTtlSeconds(now: Date, deadlineAt: Date, canonicalExpiry?: Date): number {
  const remainingWindowMilliseconds = deadlineAt.getTime() - now.getTime();
  if (remainingWindowMilliseconds <= 0) throw new ImpersonationWindowDeadlineReachedError();
  const remainingWindowSeconds = Math.ceil(remainingWindowMilliseconds / 1000);

  const remainingCanonicalMilliseconds = canonicalExpiry
    ? canonicalExpiry.getTime() - now.getTime()
    : undefined;
  if (remainingCanonicalMilliseconds !== undefined && remainingCanonicalMilliseconds <= 0) {
    throw new ImpersonationExpiredError();
  }
  const remainingCanonicalSeconds =
    remainingCanonicalMilliseconds === undefined
      ? Number.POSITIVE_INFINITY
      : Math.ceil(remainingCanonicalMilliseconds / 1000);

  return Math.min(impersonationTtlSeconds(), remainingWindowSeconds, remainingCanonicalSeconds);
}

async function mintFromSnapshot(params: {
  user: User;
  memberships: TokenMembership[];
  actorId: string;
  deadlineAt: Date;
  canonicalExpiry?: Date;
}): Promise<Awaited<ReturnType<typeof createImpersonatedSessionTokenFromClaims>>> {
  // Re-read immediately before signing: membership loading happens inside the
  // transaction and can consume a meaningful part of the remaining window.
  let ttlSeconds = tokenTtlSeconds(new Date(), params.deadlineAt, params.canonicalExpiry);
  const expiryLimit =
    params.canonicalExpiry && params.canonicalExpiry.getTime() <= params.deadlineAt.getTime()
      ? params.canonicalExpiry
      : params.deadlineAt;

  while (ttlSeconds > 0) {
    const minted = await createImpersonatedSessionTokenFromClaims({
      user: params.user,
      memberships: params.memberships,
      impersonatorId: params.actorId,
      expiresIn: `${ttlSeconds}s`,
      unique: true,
    });
    if (minted.expiresAt.getTime() <= expiryLimit.getTime()) return minted;
    ttlSeconds -= 1;
  }

  if (params.canonicalExpiry && params.canonicalExpiry.getTime() <= params.deadlineAt.getTime()) {
    throw new ImpersonationExpiredError();
  }
  throw new ImpersonationWindowDeadlineReachedError();
}

/**
 * Builds the token for a window: the administrator's identity with one
 * membership, the window's workspace, and the `impersonatorId` marker. Start,
 * idempotent replay, and continuation all mint here, so each re-checks the
 * actor's role and re-reads the workspace state. The administrator's real
 * memberships are never loaded.
 */
async function mintWindowToken(
  tx: Tx,
  params: {
    actorId: string;
    workspaceId: string;
    deadlineAt: Date;
    canonicalExpiry?: Date;
    workspaces: WorkspacesInterModuleClient;
  },
): Promise<{
  actorRole: AdminRole;
  minted: Awaited<ReturnType<typeof createImpersonatedSessionTokenFromClaims>>;
}> {
  const actorRole = await requireActiveAdminOperator(tx, params.actorId);
  const actor = await readActorUser(tx, params.actorId);
  const membership = await loadWorkspaceWindowMembership(params.workspaceId, params.workspaces);
  const minted = await mintFromSnapshot({
    user: actor,
    memberships: [membership],
    actorId: params.actorId,
    deadlineAt: params.deadlineAt,
    ...(params.canonicalExpiry ? {canonicalExpiry: params.canonicalExpiry} : {}),
  });
  return {actorRole, minted};
}

function toStoredWindowResult(
  result: ImpersonationWindowMintResult,
): StoredImpersonationWindowResult {
  return {
    windowId: result.windowId,
    workspaceId: result.workspaceId,
    windowStartedAt: result.windowStartedAt.toISOString(),
    windowDeadline: result.windowDeadline.toISOString(),
    expiresAt: result.expiresAt.toISOString(),
    tokenFingerprints: [hashToken(result.token)],
  };
}

function hashToken(token: string): string {
  return hashOpaqueToken(token);
}

function fromStoredWindowResult(
  stored: StoredImpersonationWindowResult,
  minted: Awaited<ReturnType<typeof createImpersonatedSessionTokenFromClaims>>,
  actorId: string,
  workspaceId: string,
  serverTime: Date,
): ImpersonationWindowMintResult {
  return {
    token: minted.token,
    expiresAt: new Date(stored.expiresAt),
    user: minted.user,
    impersonatorId: actorId,
    workspaceId,
    windowId: stored.windowId,
    windowStartedAt: new Date(stored.windowStartedAt),
    windowDeadline: new Date(stored.windowDeadline),
    serverTime,
  };
}

function isMintFailureAuditable(error: unknown): boolean {
  return (
    error instanceof AdminRoleRequiredError ||
    error instanceof ImpersonationDisabledError ||
    error instanceof ImpersonationExpiredError ||
    error instanceof ImpersonationWindowLimitReachedError ||
    error instanceof ImpersonationWorkspaceNotActiveError
  );
}

async function writeMintFailure(
  tx: Tx,
  params: {
    command: WindowMintCommand;
    context: MintAuditContext;
    idempotencyKeyFingerprint: string;
    correlationId: string;
    occurredAt: Date;
  },
): Promise<void> {
  const actorRole =
    params.context.actorRole ?? (await readCurrentAdminRole(tx, params.context.actorId));
  await writeAdminAction(
    tx,
    mintEvent({
      command: params.command,
      context: {...params.context, actorRole},
      result: 'failed',
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
      occurredAt: params.occurredAt,
    }),
  );
}

async function writeWindowStateFailure(
  tx: Tx,
  params: {
    command: WindowMintCommand;
    window: {
      id: string;
      actorId: string;
      targetUserId: string | null;
      workspaceId: string | null;
      reason: string | null;
      actorRoleAtStart: AdminRole;
      startedAt: Date;
      endedAt: Date | null;
      endedReason: 'stopped' | 'expired' | null;
    };
    actorId: string;
    idempotencyKeyFingerprint: string;
    correlationId: string;
    occurredAt: Date;
    error: Error;
  },
): Promise<ImpersonationWindowCommandOutcome<never>> {
  await writeMintFailure(tx, {
    command: params.command,
    context: {
      actorId: params.actorId,
      target: windowAuditTarget(params.window),
      reason: params.window.reason,
      actorRoleAtStart: params.window.actorRoleAtStart,
    },
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    correlationId: params.correlationId,
    occurredAt: params.occurredAt,
  });
  return {
    kind: 'failure',
    error: params.error,
  };
}

// JWT NumericDate values have whole-second precision. The final partial second
// cannot safely receive a bearer token, so the window is materialized at its
// authoritative deadline before the audited 410.
async function materializeFinalSecond(
  tx: Tx,
  window: ImpersonationWindow,
  now: Date,
): Promise<{window: ImpersonationWindow; transition?: ImpersonationWindowTerminalTransition}> {
  if (window.endedAt !== null || window.deadlineAt.getTime() - now.getTime() >= 1000) {
    return {window};
  }

  const materialized = await materializeImpersonationWindowExpiry(tx, {
    id: window.id,
    now: new Date(Math.max(now.getTime(), window.deadlineAt.getTime())),
  });
  if (materialized) {
    const transition = terminalTransition(materialized);
    return {window: materialized, ...(transition ? {transition} : {})};
  }

  const reloaded = await findImpersonationWindow(tx, {id: window.id});
  if (!reloaded) throw new ImpersonationWindowNotFoundError();
  return {window: reloaded};
}

async function readWindowStateFailure(
  tx: Tx,
  params: {
    command: WindowMintCommand;
    window: Awaited<ReturnType<typeof findImpersonationWindow>>;
    actorId: string;
    now: Date;
    idempotencyKeyFingerprint: string;
    correlationId: string;
  },
): Promise<ImpersonationWindowCommandOutcome<never> | undefined> {
  if (!params.window || params.window.actorId !== params.actorId) {
    throw new ImpersonationWindowNotFoundError();
  }

  const {window, transition} = await materializeFinalSecond(tx, params.window, params.now);

  if (window.endedReason === 'expired') {
    const outcome = await writeWindowStateFailure(tx, {
      command: params.command,
      window: {...window, endedAt: window.endedAt ?? window.deadlineAt},
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
      occurredAt: params.now,
      error: new ImpersonationWindowDeadlineReachedError(),
    });
    return transition ? {...outcome, terminalTransition: transition} : outcome;
  }

  // A window opened before windows targeted a workspace has no workspace to
  // mint a membership for, so it is closed to new tokens and runs out at its
  // deadline.
  if (window.endedAt !== null || window.workspaceId === null) {
    return await writeWindowStateFailure(tx, {
      command: params.command,
      window,
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
      occurredAt: params.now,
      error: new ImpersonationWindowStoppedError(),
    });
  }

  return undefined;
}

// Unreachable after `readWindowStateFailure` returned nothing; narrows the type.
function requireWindowWorkspaceId(window: {workspaceId: string | null}): string {
  if (window.workspaceId === null) throw new ImpersonationWindowStoppedError();
  return window.workspaceId;
}

// The start transaction keeps replay, expiry, ladder, capacity, signing, and
// audit ordering together so no branch can accidentally cross the security boundary.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: transaction precedence is security-sensitive
async function executeWindowMint(
  tx: Tx,
  params: ImpersonationWindowMintCommandParams,
  command: typeof IMPERSONATION_WINDOW_START_COMMAND,
): Promise<ImpersonationWindowCommandOutcome<ImpersonationWindowMintResult>> {
  const now = new Date();
  const context: MintAuditContext = {
    actorId: params.actorId,
    target: {type: 'workspace', id: params.workspaceId},
    reason: params.reason ?? null,
  };
  let windowForFailure: Awaited<ReturnType<typeof findImpersonationWindow>> | undefined;
  let terminalTransitions: ImpersonationWindowTerminalTransition[] = [];

  try {
    const existing = await findAdminCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      requestFingerprint: params.requestFingerprint,
      command,
    });

    if (existing) {
      if (!('impersonationWindow' in existing.result)) {
        throw new Error('Administrator command result has an unexpected window shape');
      }
      const stored = existing.result.impersonationWindow;
      const window = await findImpersonationWindow(tx, {id: stored.windowId});
      if (!window || window.actorId !== params.actorId) {
        throw new ImpersonationWindowNotFoundError();
      }
      windowForFailure = window;
      context.target = windowAuditTarget(window);
      context.reason = window.reason;
      context.actorRoleAtStart = window.actorRoleAtStart;

      const stateFailure = await readWindowStateFailure(tx, {
        command,
        window,
        actorId: params.actorId,
        now,
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        correlationId: params.correlationId,
      });
      if (stateFailure) return stateFailure as ImpersonationWindowCommandOutcome<never>;

      const workspaceId = requireWindowWorkspaceId(window);
      const {actorRole, minted} = await mintWindowToken(tx, {
        actorId: params.actorId,
        workspaceId,
        deadlineAt: window.deadlineAt,
        canonicalExpiry: new Date(stored.expiresAt),
        workspaces: params.workspaces,
      });
      context.actorRole = actorRole;
      await updateAdminCommandResult(
        tx,
        {
          actorId: params.actorId,
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          requestFingerprint: params.requestFingerprint,
        },
        {
          impersonationWindow: {
            ...stored,
            tokenFingerprints: [...stored.tokenFingerprints, hashToken(minted.token)],
          },
        },
      );
      await writeAdminAction(
        tx,
        mintEvent({
          command,
          context: {...context, actorRole},
          result: 'succeeded',
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          correlationId: params.correlationId,
          occurredAt: now,
        }),
      );
      return {
        kind: 'success',
        result: fromStoredWindowResult(stored, minted, params.actorId, workspaceId, now),
      };
    }

    // The role check comes before the capacity check so a denied actor is never
    // reported as being at the window limit; the minting helper checks it again.
    await requireActiveAdminOperator(tx, params.actorId);
    const expiredWindows = await requireImpersonationWindowCapacity(tx, {
      actorId: params.actorId,
      now,
    });
    terminalTransitions = expiredWindows.flatMap((expiredWindow) => {
      const transition = terminalTransition(expiredWindow);
      return transition ? [transition] : [];
    });

    const deadlineAt = new Date(now.getTime() + params.windowMaxSeconds * 1000);
    const {actorRole, minted} = await mintWindowToken(tx, {
      actorId: params.actorId,
      workspaceId: params.workspaceId,
      deadlineAt,
      workspaces: params.workspaces,
    });
    context.actorRole = actorRole;
    context.actorRoleAtStart = actorRole;

    const window = await createImpersonationWindow(tx, {
      actorId: params.actorId,
      workspaceId: params.workspaceId,
      reason: params.reason ?? null,
      actorRoleAtStart: actorRole,
      startedAt: now,
      deadlineAt,
    });
    windowForFailure = window;
    const result: ImpersonationWindowMintResult = {
      token: minted.token,
      expiresAt: minted.expiresAt,
      user: minted.user,
      impersonatorId: params.actorId,
      workspaceId: params.workspaceId,
      windowId: window.id,
      windowStartedAt: window.startedAt,
      windowDeadline: window.deadlineAt,
      serverTime: now,
    };
    await storeAdminCommandResult(
      tx,
      {
        actorId: params.actorId,
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        requestFingerprint: params.requestFingerprint,
        command,
      },
      {impersonationWindow: toStoredWindowResult(result)},
    );
    await writeAdminAction(
      tx,
      mintEvent({
        command,
        context: {...context, actorRole},
        result: 'succeeded',
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        correlationId: params.correlationId,
        occurredAt: now,
      }),
    );
    return {
      kind: 'success',
      result,
      ...(terminalTransitions.length > 0 ? {terminalTransitions} : {}),
    };
  } catch (error) {
    if (error instanceof AdminIdempotencyKeyReuseError || error instanceof UserNotFoundError) {
      throw error;
    }
    if (error instanceof ImpersonationWindowDeadlineReachedError && windowForFailure) {
      const stateFailure = await readWindowStateFailure(tx, {
        command,
        window: windowForFailure,
        actorId: params.actorId,
        now: new Date(),
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        correlationId: params.correlationId,
      });
      if (stateFailure) return stateFailure as ImpersonationWindowCommandOutcome<never>;
    }
    if (!isMintFailureAuditable(error)) throw error;
    await writeMintFailure(tx, {
      command,
      context,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
      occurredAt: now,
    });
    return {
      kind: 'failure',
      error: error as Error,
      ...(terminalTransitions.length > 0 ? {terminalTransitions} : {}),
    };
  }
}

// Continue intentionally keeps the full issuance and replay ladder in one
// transaction so every bearer issuance observes the same authorization boundary.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: transaction precedence is security-sensitive
async function executeWindowContinue(
  tx: Tx,
  params: ImpersonationWindowContinueCommandParams,
): Promise<ImpersonationWindowCommandOutcome<ImpersonationWindowMintResult>> {
  const now = new Date();
  let context: MintAuditContext | undefined;
  let window: Awaited<ReturnType<typeof findImpersonationWindow>> | undefined;

  try {
    const existing = await findAdminCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      requestFingerprint: params.requestFingerprint,
      command: IMPERSONATION_WINDOW_CONTINUE_COMMAND,
    });
    window = await findImpersonationWindow(tx, {id: params.windowId});
    if (!window || window.actorId !== params.actorId) {
      throw new ImpersonationWindowNotFoundError();
    }
    context = {
      actorId: params.actorId,
      target: windowAuditTarget(window),
      reason: window.reason,
      actorRoleAtStart: window.actorRoleAtStart,
    };

    const stateFailure = await readWindowStateFailure(tx, {
      command: IMPERSONATION_WINDOW_CONTINUE_COMMAND,
      window,
      actorId: params.actorId,
      now,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
    });
    if (stateFailure) return stateFailure as ImpersonationWindowCommandOutcome<never>;

    const workspaceId = requireWindowWorkspaceId(window);
    const stored = existing
      ? (() => {
          if (!('impersonationWindow' in existing.result)) {
            throw new Error('Administrator command result has an unexpected window shape');
          }
          return existing.result.impersonationWindow;
        })()
      : undefined;
    const canonicalExpiry = stored ? new Date(stored.expiresAt) : undefined;
    const {actorRole, minted} = await mintWindowToken(tx, {
      actorId: params.actorId,
      workspaceId,
      deadlineAt: window.deadlineAt,
      ...(canonicalExpiry ? {canonicalExpiry} : {}),
      workspaces: params.workspaces,
    });
    context.actorRole = actorRole;
    const result: ImpersonationWindowMintResult = {
      token: minted.token,
      expiresAt: stored ? (canonicalExpiry ?? minted.expiresAt) : minted.expiresAt,
      user: minted.user,
      impersonatorId: params.actorId,
      workspaceId,
      windowId: window.id,
      windowStartedAt: window.startedAt,
      windowDeadline: window.deadlineAt,
      serverTime: now,
    };

    if (stored) {
      await updateAdminCommandResult(
        tx,
        {
          actorId: params.actorId,
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          requestFingerprint: params.requestFingerprint,
        },
        {
          impersonationWindow: {
            ...stored,
            tokenFingerprints: [...stored.tokenFingerprints, hashToken(result.token)],
          },
        },
      );
    } else {
      await storeAdminCommandResult(
        tx,
        {
          actorId: params.actorId,
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          requestFingerprint: params.requestFingerprint,
          command: IMPERSONATION_WINDOW_CONTINUE_COMMAND,
        },
        {
          impersonationWindow: {
            windowId: window.id,
            workspaceId,
            windowStartedAt: window.startedAt.toISOString(),
            windowDeadline: window.deadlineAt.toISOString(),
            expiresAt: result.expiresAt.toISOString(),
            tokenFingerprints: [hashToken(result.token)],
          },
        },
      );
    }
    await writeAdminAction(
      tx,
      mintEvent({
        command: IMPERSONATION_WINDOW_CONTINUE_COMMAND,
        context: {...context, actorRole},
        result: 'succeeded',
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        correlationId: params.correlationId,
        occurredAt: now,
      }),
    );
    return {kind: 'success', result};
  } catch (error) {
    if (
      error instanceof AdminIdempotencyKeyReuseError ||
      error instanceof UserNotFoundError ||
      error instanceof ImpersonationWindowNotFoundError
    ) {
      throw error;
    }
    if (error instanceof ImpersonationWindowDeadlineReachedError && window) {
      const stateFailure = await readWindowStateFailure(tx, {
        command: IMPERSONATION_WINDOW_CONTINUE_COMMAND,
        window,
        actorId: params.actorId,
        now: new Date(),
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        correlationId: params.correlationId,
      });
      if (stateFailure) return stateFailure as ImpersonationWindowCommandOutcome<never>;
    }
    if (!isMintFailureAuditable(error) || !context) throw error;
    await writeMintFailure(tx, {
      command: IMPERSONATION_WINDOW_CONTINUE_COMMAND,
      context,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
      occurredAt: now,
    });
    return {kind: 'failure', error: error as Error};
  }
}

export async function startImpersonationWindowCommand(
  params: ImpersonationWindowMintCommandParams,
): Promise<ImpersonationWindowCommandOutcome<ImpersonationWindowMintResult>> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    await lockAdminOwnerGrants(tx, 'shared');
    await lockImpersonationWindowActor(tx, params.actorId);
    return await executeWindowMint(tx, params, IMPERSONATION_WINDOW_START_COMMAND);
  });
}

export async function continueImpersonationWindowCommand(
  params: ImpersonationWindowContinueCommandParams,
): Promise<ImpersonationWindowCommandOutcome<ImpersonationWindowMintResult>> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    await lockAdminOwnerGrants(tx, 'shared');
    await lockImpersonationWindowActor(tx, params.actorId);
    return await executeWindowContinue(tx, params);
  });
}

function storedStopResult(result: unknown): StoredImpersonationWindowStopResult {
  if (!result || typeof result !== 'object' || !('impersonationWindowStop' in result)) {
    throw new Error('Administrator command result has an unexpected Stop shape');
  }
  return (result as {impersonationWindowStop: StoredImpersonationWindowStopResult})
    .impersonationWindowStop;
}

async function readOwnerRole(tx: Tx, actorId: string): Promise<AdminRole> {
  const role = await readCurrentAdminRole(tx, actorId);
  if (!role || !hasMinimumAdminRole(role, IMPERSONATION_OWNER_ROLE)) {
    throw new ImpersonationWindowNotFoundError();
  }
  return role;
}

// Stop has separate owned and owner-override lock paths, plus terminal replay
// handling; keeping them in one transaction prevents an authority-reducing race.
export async function stopImpersonationWindowCommand(
  params: ImpersonationWindowStopCommandParams,
): Promise<ImpersonationWindowCommandOutcome<ImpersonationWindowStopResult>> {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lock and terminal precedence is security-sensitive
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    // Derive the actor lock from a transaction-scoped row read. The shared
    // grant lock is conservative for owned Stop, but it keeps every possible
    // owner-override path ordered before the actor lock without depending on
    // a pre-transaction authorization snapshot.
    await lockAdminOwnerGrants(tx, 'shared');

    const existing = await findAdminCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      requestFingerprint: params.requestFingerprint,
      command: IMPERSONATION_WINDOW_STOP_COMMAND,
    });
    if (existing) {
      const stored = storedStopResult(existing.result);
      return {
        kind: 'success',
        result: {
          windowId: stored.windowId,
          state: stored.state,
          endedAt: new Date(stored.endedAt),
        },
      };
    }

    const preliminaryWindow = await findImpersonationWindow(tx, {id: params.windowId});
    if (!preliminaryWindow) throw new ImpersonationWindowNotFoundError();
    await lockImpersonationWindowActor(tx, preliminaryWindow.actorId);
    const window = await findImpersonationWindow(tx, {id: params.windowId});
    if (!window) throw new ImpersonationWindowNotFoundError();

    const owned = window.actorId === params.actorId;
    let actorRole: AdminRole | null = null;
    if (!owned) {
      actorRole = await readOwnerRole(tx, params.actorId);
    }

    const now = new Date();
    if (window.endedAt !== null) {
      const stored: StoredImpersonationWindowStopResult = {
        windowId: window.id,
        state: window.endedReason === 'expired' ? 'expired' : 'stopped',
        endedAt: window.endedAt.toISOString(),
      };
      await storeAdminCommandResult(
        tx,
        {
          actorId: params.actorId,
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          requestFingerprint: params.requestFingerprint,
          command: IMPERSONATION_WINDOW_STOP_COMMAND,
        },
        {impersonationWindowStop: stored},
      );
      return {
        kind: 'success',
        result: {
          windowId: stored.windowId,
          state: stored.state,
          endedAt: new Date(stored.endedAt),
        },
      };
    }

    if (window.deadlineAt.getTime() <= now.getTime()) {
      const materialized = await materializeImpersonationWindowExpiry(tx, {
        id: window.id,
        now,
      });
      const expired = materialized ?? (await findImpersonationWindow(tx, {id: window.id}));
      if (!expired) throw new ImpersonationWindowNotFoundError();
      const stored: StoredImpersonationWindowStopResult = {
        windowId: expired.id,
        state: 'expired',
        endedAt: (expired.endedAt ?? expired.deadlineAt).toISOString(),
      };
      await storeAdminCommandResult(
        tx,
        {
          actorId: params.actorId,
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          requestFingerprint: params.requestFingerprint,
          command: IMPERSONATION_WINDOW_STOP_COMMAND,
        },
        {impersonationWindowStop: stored},
      );
      if (materialized) {
        const reason = params.reason ?? window.reason;
        await writeAdminAction(
          tx,
          stopEvent({
            actorId: params.actorId,
            windowId: expired.id,
            actorRole,
            actorRoleAtStart: window.actorRoleAtStart,
            reason,
            idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
            correlationId: params.correlationId,
            occurredAt: now,
            owned,
          }),
        );
      }
      const transition = materialized ? terminalTransition(expired) : undefined;
      return {
        kind: 'success',
        result: {
          windowId: stored.windowId,
          state: stored.state,
          endedAt: new Date(stored.endedAt),
        },
        ...(transition ? {terminalTransition: transition} : {}),
      };
    }

    const stopped = await stopImpersonationWindow(tx, {
      id: window.id,
      endedAt: now,
      now,
    });
    if (!stopped) throw new ImpersonationWindowNotFoundError();
    const reason = params.reason ?? window.reason;
    const event = stopEvent({
      actorId: params.actorId,
      windowId: window.id,
      actorRole,
      actorRoleAtStart: window.actorRoleAtStart,
      reason,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
      occurredAt: now,
      owned,
    });
    const stored: StoredImpersonationWindowStopResult = {
      windowId: stopped.id,
      state: stopped.endedReason === 'expired' ? 'expired' : 'stopped',
      endedAt: (stopped.endedAt ?? now).toISOString(),
    };
    await storeAdminCommandResult(
      tx,
      {
        actorId: params.actorId,
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        requestFingerprint: params.requestFingerprint,
        command: IMPERSONATION_WINDOW_STOP_COMMAND,
      },
      {impersonationWindowStop: stored},
    );
    await writeAdminAction(tx, event);
    const transition = terminalTransition(stopped);
    return {
      kind: 'success',
      result: {
        windowId: stored.windowId,
        state: stored.state,
        endedAt: new Date(stored.endedAt),
      },
      ...(transition ? {terminalTransition: transition} : {}),
    };
  });
}

export async function publishImpersonationWindowFailure(params: {
  command: WindowMintCommand;
  actorId: string;
  targetType: 'workspace' | 'impersonation-window';
  targetId: string;
  reason: string | null;
  actorRoleAtStart?: AdminRole | undefined;
  idempotencyKeyFingerprint: string;
  correlationId: string;
}): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      const actorRole = await readCurrentAdminRole(tx, params.actorId);
      await writeAdminAction(
        tx,
        mintEvent({
          command: params.command,
          context: {
            actorId: params.actorId,
            target: {type: params.targetType, id: params.targetId},
            reason: params.reason,
            actorRole,
            ...(params.actorRoleAtStart === undefined
              ? {}
              : {actorRoleAtStart: params.actorRoleAtStart}),
          },
          result: 'failed',
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          correlationId: params.correlationId,
          occurredAt: new Date(),
        }),
      );
    });
  } catch (error) {
    recordImpersonationAuditWriteFailure();
    logger().warn(
      {err: error, command: params.command, correlationId: params.correlationId},
      'Failed to record impersonation failure audit event',
    );
    // A failure audit must never replace the original command outcome.
  }
}

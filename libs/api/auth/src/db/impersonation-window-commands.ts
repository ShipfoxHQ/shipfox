import type {AdminRole, ImpersonationWindowState} from '@shipfox/api-auth-dto';
import {
  type AdministrationActionEvent,
  type AdministrationActionResult,
  createAdministrationActionEvent,
} from '@shipfox/api-common-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull} from 'drizzle-orm';
import {hasMinimumAdminRole, highestAdminRole} from '#core/admin-role-model.js';
import {
  createImpersonatedSessionTokenFromClaims,
  impersonationTtlSeconds,
  loadTokenMemberships,
} from '#core/auth.js';
import type {User} from '#core/entities/user.js';
import {
  AdminIdempotencyKeyReuseError,
  AdminRoleRequiredError,
  CannotImpersonateAdministratorError,
  CannotImpersonateSelfError,
  ImpersonationDisabledError,
  ImpersonationExpiredError,
  ImpersonationStopReasonRequiredError,
  ImpersonationTargetNotActiveError,
  ImpersonationTargetNotWorkspaceMemberError,
  ImpersonationWindowDeadlineReachedError,
  ImpersonationWindowLimitReachedError,
  ImpersonationWindowNotFoundError,
  ImpersonationWindowStoppedError,
  UserNotFoundError,
} from '#core/errors.js';
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
import {db} from './db.js';
import {runImpersonationLadder} from './impersonation.js';
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
  targetUserId: string;
  reason: string;
  requiredWorkspaceId?: string | undefined;
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
  preliminaryWindowActorId?: string | undefined;
}

export interface ImpersonationWindowMintResult {
  token: string;
  expiresAt: Date;
  user: User;
  impersonatorId: string;
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
    };

interface MintAuditContext {
  actorId: string;
  targetUserId: string;
  reason: string;
  actorRole?: AdminRole | null | undefined;
  actorRoleAtStart?: AdminRole | undefined;
}

function mintEvent(params: {
  command: WindowMintCommand;
  context: MintAuditContext;
  targetType?: 'user' | 'impersonation-window';
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
    targetType: params.targetType ?? 'user',
    targetId: params.context.targetUserId,
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
  reason: string;
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

async function readTargetUser(tx: Tx, targetUserId: string): Promise<User> {
  const rows = await tx.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  const row = rows[0];
  if (!row || row.status === 'deleted') throw new UserNotFoundError(targetUserId);
  return toUser(row);
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
  const remainingWindowSeconds = Math.floor((deadlineAt.getTime() - now.getTime()) / 1000);
  if (remainingWindowSeconds <= 0) throw new ImpersonationWindowDeadlineReachedError();

  const remainingCanonicalSeconds = canonicalExpiry
    ? Math.floor((canonicalExpiry.getTime() - now.getTime()) / 1000)
    : Number.POSITIVE_INFINITY;
  if (remainingCanonicalSeconds <= 0) throw new ImpersonationExpiredError();

  return Math.min(impersonationTtlSeconds(), remainingWindowSeconds, remainingCanonicalSeconds);
}

async function mintFromSnapshot(params: {
  user: User;
  memberships: Awaited<ReturnType<typeof loadTokenMemberships>>;
  actorId: string;
  now: Date;
  deadlineAt: Date;
  canonicalExpiry?: Date;
}): Promise<Awaited<ReturnType<typeof createImpersonatedSessionTokenFromClaims>>> {
  const expiresIn = `${tokenTtlSeconds(params.now, params.deadlineAt, params.canonicalExpiry)}s`;
  return await createImpersonatedSessionTokenFromClaims({
    user: params.user,
    memberships: params.memberships,
    impersonatorId: params.actorId,
    expiresIn,
    unique: true,
  });
}

function toStoredWindowResult(
  result: ImpersonationWindowMintResult,
): StoredImpersonationWindowResult {
  return {
    windowId: result.windowId,
    targetUserId: result.user.id,
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
  serverTime: Date,
): ImpersonationWindowMintResult {
  return {
    token: minted.token,
    expiresAt: new Date(stored.expiresAt),
    user: minted.user,
    impersonatorId: actorId,
    windowId: stored.windowId,
    windowStartedAt: new Date(stored.windowStartedAt),
    windowDeadline: new Date(stored.windowDeadline),
    serverTime,
  };
}

function isMintFailureAuditable(error: unknown): boolean {
  return (
    error instanceof AdminRoleRequiredError ||
    error instanceof CannotImpersonateAdministratorError ||
    error instanceof CannotImpersonateSelfError ||
    error instanceof ImpersonationDisabledError ||
    error instanceof ImpersonationExpiredError ||
    error instanceof ImpersonationTargetNotActiveError ||
    error instanceof ImpersonationTargetNotWorkspaceMemberError ||
    error instanceof ImpersonationWindowLimitReachedError
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
      actorId: string;
      targetUserId: string;
      reason: string;
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
      targetUserId: params.window.targetUserId,
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

  let window = params.window;
  let transition: ImpersonationWindowTerminalTransition | undefined;
  if (window.endedAt === null && window.deadlineAt.getTime() <= params.now.getTime()) {
    const materialized = await materializeImpersonationWindowExpiry(tx, {
      id: window.id,
      now: params.now,
    });
    if (materialized) {
      window = materialized;
      transition = terminalTransition(window);
    } else {
      const reloaded = await findImpersonationWindow(tx, {id: window.id});
      if (!reloaded) throw new ImpersonationWindowNotFoundError();
      window = reloaded;
    }
  }

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

  if (window.endedAt !== null) {
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
    targetUserId: params.targetUserId,
    reason: params.reason,
  };

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
      context.targetUserId = window.targetUserId;
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

      const actorRole = await runImpersonationLadder(tx, {
        actorId: params.actorId,
        targetUserId: window.targetUserId,
      });
      context.actorRole = actorRole;
      const target = await readTargetUser(tx, window.targetUserId);
      const memberships = await loadTokenMemberships(target.id, params.workspaces);
      if (
        params.requiredWorkspaceId &&
        !memberships.some(
          (membership) =>
            membership.workspaceId === params.requiredWorkspaceId &&
            membership.workspaceStatus === 'active',
        )
      ) {
        throw new ImpersonationTargetNotWorkspaceMemberError();
      }

      const canonicalExpiry = new Date(stored.expiresAt);
      const minted = await mintFromSnapshot({
        user: target,
        memberships,
        actorId: params.actorId,
        now,
        deadlineAt: window.deadlineAt,
        canonicalExpiry,
      });
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
        result: fromStoredWindowResult(stored, minted, params.actorId, now),
      };
    }

    const actorRole = await runImpersonationLadder(tx, {
      actorId: params.actorId,
      targetUserId: params.targetUserId,
    });
    context.actorRole = actorRole;
    context.actorRoleAtStart = actorRole;

    const expiredWindows = await requireImpersonationWindowCapacity(tx, {
      actorId: params.actorId,
      now,
    });
    const terminalTransitions = expiredWindows.flatMap((expiredWindow) => {
      const transition = terminalTransition(expiredWindow);
      return transition ? [transition] : [];
    });

    const target = await readTargetUser(tx, params.targetUserId);
    const memberships = await loadTokenMemberships(target.id, params.workspaces);
    if (
      params.requiredWorkspaceId &&
      !memberships.some(
        (membership) =>
          membership.workspaceId === params.requiredWorkspaceId &&
          membership.workspaceStatus === 'active',
      )
    ) {
      throw new ImpersonationTargetNotWorkspaceMemberError();
    }

    const window = await createImpersonationWindow(tx, {
      actorId: params.actorId,
      targetUserId: target.id,
      reason: params.reason,
      actorRoleAtStart: actorRole,
      startedAt: now,
      deadlineAt: new Date(now.getTime() + params.windowMaxSeconds * 1000),
    });
    const minted = await mintFromSnapshot({
      user: target,
      memberships,
      actorId: params.actorId,
      now,
      deadlineAt: window.deadlineAt,
    });
    const result: ImpersonationWindowMintResult = {
      token: minted.token,
      expiresAt: minted.expiresAt,
      user: minted.user,
      impersonatorId: params.actorId,
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
    if (!isMintFailureAuditable(error)) throw error;
    await writeMintFailure(tx, {
      command,
      context,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
      occurredAt: now,
    });
    return {kind: 'failure', error: error as Error};
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

  try {
    const existing = await findAdminCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      requestFingerprint: params.requestFingerprint,
      command: IMPERSONATION_WINDOW_CONTINUE_COMMAND,
    });
    const window = await findImpersonationWindow(tx, {id: params.windowId});
    if (!window || window.actorId !== params.actorId) {
      throw new ImpersonationWindowNotFoundError();
    }
    context = {
      actorId: params.actorId,
      targetUserId: window.targetUserId,
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

    const actorRole = await runImpersonationLadder(tx, {
      actorId: params.actorId,
      targetUserId: window.targetUserId,
    });
    context.actorRole = actorRole;
    const target = await readTargetUser(tx, window.targetUserId);
    const memberships = await loadTokenMemberships(target.id, params.workspaces);
    const stored = existing
      ? (() => {
          if (!('impersonationWindow' in existing.result)) {
            throw new Error('Administrator command result has an unexpected window shape');
          }
          return existing.result.impersonationWindow;
        })()
      : undefined;
    const canonicalExpiry = stored ? new Date(stored.expiresAt) : undefined;
    const minted = await mintFromSnapshot({
      user: target,
      memberships,
      actorId: params.actorId,
      now,
      deadlineAt: window.deadlineAt,
      ...(canonicalExpiry ? {canonicalExpiry} : {}),
    });
    const result: ImpersonationWindowMintResult = {
      token: minted.token,
      expiresAt: stored ? (canonicalExpiry ?? minted.expiresAt) : minted.expiresAt,
      user: minted.user,
      impersonatorId: params.actorId,
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
            targetUserId: window.targetUserId,
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
    const windowActorId = params.preliminaryWindowActorId ?? params.actorId;
    const ownedByCaller = windowActorId === params.actorId;
    if (!ownedByCaller) await lockAdminOwnerGrants(tx, 'shared');
    await lockImpersonationWindowActor(tx, windowActorId);

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

    const window = await findImpersonationWindow(tx, {id: params.windowId});
    if (!window) throw new ImpersonationWindowNotFoundError();

    const owned = window.actorId === params.actorId;
    let actorRole: AdminRole | null = null;
    if (!owned) {
      actorRole = await readOwnerRole(tx, params.actorId);
      if (!params.reason) throw new ImpersonationStopReasonRequiredError();
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
  targetType: 'user' | 'impersonation-window';
  targetId: string;
  reason: string;
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
          targetType: params.targetType,
          context: {
            actorId: params.actorId,
            targetUserId: params.targetId,
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
  } catch {
    // A failure audit must never replace the original command outcome.
  }
}

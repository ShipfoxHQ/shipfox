import type {AdminRole} from '@shipfox/api-auth-dto';
import {
  paginateTimestampIdRows,
  type TimestampIdCursor,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {and, count, desc, eq, gt, isNull, lte, sql} from 'drizzle-orm';
import type {
  EffectiveImpersonationWindow,
  ImpersonationWindow,
  ImpersonationWindowEndedReason,
} from '#core/entities/impersonation-window.js';
import {
  MAX_OPEN_IMPERSONATION_WINDOWS,
  toEffectiveImpersonationWindow,
} from '#core/entities/impersonation-window.js';
import {ImpersonationWindowLimitReachedError} from '#core/errors.js';
import type {Tx} from './admin-command.js';
import {db} from './db.js';
import {
  type ImpersonationWindowCreateDb,
  type ImpersonationWindowDb,
  impersonationWindows,
} from './schema/impersonation-windows.js';

export type ImpersonationWindowExecutor = ReturnType<typeof db> | Tx;

export interface CreateImpersonationWindowParams {
  id?: string;
  actorId: string;
  targetUserId: string;
  reason: string;
  actorRoleAtStart: AdminRole;
  startedAt: Date;
  deadlineAt: Date;
  now?: Date;
  endedAt?: Date | null;
  endedReason?: ImpersonationWindowEndedReason | null;
}

export interface ImpersonationWindowLookupParams {
  id: string;
}

export interface ListOpenImpersonationWindowsParams {
  actorId: string;
  now: Date;
  limit: number;
  cursor?: TimestampIdCursor | undefined;
}

export interface ListImpersonationWindowsByTargetParams {
  targetUserId: string;
  limit: number;
  cursor?: TimestampIdCursor | undefined;
}

export interface ImpersonationWindowTimeParams {
  id: string;
  now: Date;
}

export interface ImpersonationWindowActorTimeParams {
  actorId: string;
  now: Date;
}

export interface StopImpersonationWindowParams {
  id: string;
  endedAt: Date;
  now: Date;
}

function isExecutor(value: unknown): value is ImpersonationWindowExecutor {
  return typeof value === 'object' && value !== null && 'select' in value && 'insert' in value;
}

function resolveExecutorAndParams<T>(
  first: T | ImpersonationWindowExecutor,
  second: T | ImpersonationWindowExecutor | undefined,
): {executor: ImpersonationWindowExecutor; params: T} {
  if (second === undefined) return {executor: db(), params: first as T};
  if (isExecutor(first)) return {executor: first, params: second as T};
  return {executor: second as ImpersonationWindowExecutor, params: first as T};
}

export function toImpersonationWindow(row: ImpersonationWindowDb): ImpersonationWindow {
  return {
    id: row.id,
    actorId: row.actorId,
    targetUserId: row.targetUserId,
    reason: row.reason,
    actorRoleAtStart: row.actorRoleAtStart,
    startedAt: row.startedAt,
    deadlineAt: row.deadlineAt,
    endedAt: row.endedAt,
    endedReason: row.endedReason as ImpersonationWindow['endedReason'],
  };
}

export async function createImpersonationWindow(
  params: CreateImpersonationWindowParams,
  executor?: ImpersonationWindowExecutor,
): Promise<ImpersonationWindow>;
export async function createImpersonationWindow(
  executor: ImpersonationWindowExecutor,
  params: CreateImpersonationWindowParams,
): Promise<ImpersonationWindow>;
export async function createImpersonationWindow(
  first: CreateImpersonationWindowParams | ImpersonationWindowExecutor,
  second?: CreateImpersonationWindowParams | ImpersonationWindowExecutor,
): Promise<ImpersonationWindow> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  if (params.now) {
    await requireImpersonationWindowCapacity(executor, {
      actorId: params.actorId,
      now: params.now,
    });
  }
  const values: ImpersonationWindowCreateDb = {
    actorId: params.actorId,
    targetUserId: params.targetUserId,
    reason: params.reason,
    actorRoleAtStart: params.actorRoleAtStart,
    startedAt: params.startedAt,
    deadlineAt: params.deadlineAt,
    endedAt: params.endedAt ?? null,
    endedReason: params.endedReason ?? null,
    ...(params.id ? {id: params.id} : {}),
  };
  const rows = await executor.insert(impersonationWindows).values(values).returning();
  const row = rows[0];
  if (!row) throw new Error('Impersonation window insert returned no rows');
  return toImpersonationWindow(row);
}

export const insertImpersonationWindow = createImpersonationWindow;

export async function findImpersonationWindow(
  params: ImpersonationWindowLookupParams,
  executor?: ImpersonationWindowExecutor,
): Promise<ImpersonationWindow | undefined>;
export async function findImpersonationWindow(
  executor: ImpersonationWindowExecutor,
  params: ImpersonationWindowLookupParams,
): Promise<ImpersonationWindow | undefined>;
export async function findImpersonationWindow(
  first: ImpersonationWindowLookupParams | ImpersonationWindowExecutor,
  second?: ImpersonationWindowLookupParams | ImpersonationWindowExecutor,
): Promise<ImpersonationWindow | undefined> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const rows = await executor
    .select()
    .from(impersonationWindows)
    .where(eq(impersonationWindows.id, params.id))
    .limit(1);
  const row = rows[0];
  return row ? toImpersonationWindow(row) : undefined;
}

export const findImpersonationWindowById = findImpersonationWindow;

export interface ImpersonationWindowPage {
  rows: ImpersonationWindow[];
  nextCursor: TimestampIdCursor | null;
}

export async function listOpenImpersonationWindows(
  params: ListOpenImpersonationWindowsParams,
  executor?: ImpersonationWindowExecutor,
): Promise<ImpersonationWindowPage>;
export async function listOpenImpersonationWindows(
  executor: ImpersonationWindowExecutor,
  params: ListOpenImpersonationWindowsParams,
): Promise<ImpersonationWindowPage>;
export async function listOpenImpersonationWindows(
  first: ListOpenImpersonationWindowsParams | ImpersonationWindowExecutor,
  second?: ListOpenImpersonationWindowsParams | ImpersonationWindowExecutor,
): Promise<ImpersonationWindowPage> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: impersonationWindows.startedAt,
    idColumn: impersonationWindows.id,
    cursor: params.cursor,
  });
  const conditions = [
    eq(impersonationWindows.actorId, params.actorId),
    isNull(impersonationWindows.endedAt),
    gt(impersonationWindows.deadlineAt, params.now),
    ...(cursorCondition ? [cursorCondition] : []),
  ];
  const rows = await executor
    .select()
    .from(impersonationWindows)
    .where(and(...conditions))
    .orderBy(desc(impersonationWindows.startedAt), desc(impersonationWindows.id))
    .limit(params.limit + 1);
  const page = paginateTimestampIdRows({
    rows: rows.map(toImpersonationWindow),
    limit: params.limit,
    timestampKey: 'startedAt',
  });
  return {rows: page.pageRows, nextCursor: page.nextCursor};
}

export const listOpenImpersonationWindowsForActor = listOpenImpersonationWindows;

export async function listImpersonationWindowsByTarget(
  params: ListImpersonationWindowsByTargetParams,
  executor?: ImpersonationWindowExecutor,
): Promise<ImpersonationWindowPage>;
export async function listImpersonationWindowsByTarget(
  executor: ImpersonationWindowExecutor,
  params: ListImpersonationWindowsByTargetParams,
): Promise<ImpersonationWindowPage>;
export async function listImpersonationWindowsByTarget(
  first: ListImpersonationWindowsByTargetParams | ImpersonationWindowExecutor,
  second?: ListImpersonationWindowsByTargetParams | ImpersonationWindowExecutor,
): Promise<ImpersonationWindowPage> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: impersonationWindows.startedAt,
    idColumn: impersonationWindows.id,
    cursor: params.cursor,
  });
  const conditions = [
    eq(impersonationWindows.targetUserId, params.targetUserId),
    ...(cursorCondition ? [cursorCondition] : []),
  ];
  const rows = await executor
    .select()
    .from(impersonationWindows)
    .where(and(...conditions))
    .orderBy(desc(impersonationWindows.startedAt), desc(impersonationWindows.id))
    .limit(params.limit + 1);
  const page = paginateTimestampIdRows({
    rows: rows.map(toImpersonationWindow),
    limit: params.limit,
    timestampKey: 'startedAt',
  });
  return {rows: page.pageRows, nextCursor: page.nextCursor};
}

export const listImpersonationWindowsForTarget = listImpersonationWindowsByTarget;

export async function getEffectiveImpersonationWindow(
  params: ImpersonationWindowTimeParams,
  executor?: ImpersonationWindowExecutor,
): Promise<EffectiveImpersonationWindow | undefined>;
export async function getEffectiveImpersonationWindow(
  executor: ImpersonationWindowExecutor,
  params: ImpersonationWindowTimeParams,
): Promise<EffectiveImpersonationWindow | undefined>;
export async function getEffectiveImpersonationWindow(
  first: ImpersonationWindowTimeParams | ImpersonationWindowExecutor,
  second?: ImpersonationWindowTimeParams | ImpersonationWindowExecutor,
): Promise<EffectiveImpersonationWindow | undefined> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const window = await findImpersonationWindow(executor, {id: params.id});
  return window ? toEffectiveImpersonationWindow(window, params.now) : undefined;
}

export async function getEffectiveImpersonationWindowState(
  params: ImpersonationWindowTimeParams,
  executor?: ImpersonationWindowExecutor,
): Promise<EffectiveImpersonationWindow['state'] | undefined> {
  const window = await getEffectiveImpersonationWindow(params, executor);
  return window?.state;
}

export async function materializeImpersonationWindowExpiry(
  params: ImpersonationWindowTimeParams,
  executor?: ImpersonationWindowExecutor,
): Promise<ImpersonationWindow | undefined>;
export async function materializeImpersonationWindowExpiry(
  executor: ImpersonationWindowExecutor,
  params: ImpersonationWindowTimeParams,
): Promise<ImpersonationWindow | undefined>;
export async function materializeImpersonationWindowExpiry(
  first: ImpersonationWindowTimeParams | ImpersonationWindowExecutor,
  second?: ImpersonationWindowTimeParams | ImpersonationWindowExecutor,
): Promise<ImpersonationWindow | undefined> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const rows = await executor
    .update(impersonationWindows)
    .set({
      endedAt: sql`${impersonationWindows.deadlineAt}`,
      endedReason: 'expired',
    })
    .where(
      and(
        eq(impersonationWindows.id, params.id),
        isNull(impersonationWindows.endedAt),
        lte(impersonationWindows.deadlineAt, params.now),
      ),
    )
    .returning();
  const row = rows[0];
  return row ? toImpersonationWindow(row) : undefined;
}

export async function materializeExpiredImpersonationWindows(
  params: ImpersonationWindowActorTimeParams,
  executor?: ImpersonationWindowExecutor,
): Promise<ImpersonationWindow[]>;
export async function materializeExpiredImpersonationWindows(
  executor: ImpersonationWindowExecutor,
  params: ImpersonationWindowActorTimeParams,
): Promise<ImpersonationWindow[]>;
export async function materializeExpiredImpersonationWindows(
  first: ImpersonationWindowActorTimeParams | ImpersonationWindowExecutor,
  second?: ImpersonationWindowActorTimeParams | ImpersonationWindowExecutor,
): Promise<ImpersonationWindow[]> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const rows = await executor
    .update(impersonationWindows)
    .set({
      endedAt: sql`${impersonationWindows.deadlineAt}`,
      endedReason: 'expired',
    })
    .where(
      and(
        eq(impersonationWindows.actorId, params.actorId),
        isNull(impersonationWindows.endedAt),
        lte(impersonationWindows.deadlineAt, params.now),
      ),
    )
    .returning();
  return rows.map(toImpersonationWindow);
}

export const materializeExpiredImpersonationWindowsForActor =
  materializeExpiredImpersonationWindows;

export async function countOpenImpersonationWindows(
  params: ImpersonationWindowActorTimeParams,
  executor?: ImpersonationWindowExecutor,
): Promise<number>;
export async function countOpenImpersonationWindows(
  executor: ImpersonationWindowExecutor,
  params: ImpersonationWindowActorTimeParams,
): Promise<number>;
export async function countOpenImpersonationWindows(
  first: ImpersonationWindowActorTimeParams | ImpersonationWindowExecutor,
  second?: ImpersonationWindowActorTimeParams | ImpersonationWindowExecutor,
): Promise<number> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const rows = await executor
    .select({count: count()})
    .from(impersonationWindows)
    .where(
      and(
        eq(impersonationWindows.actorId, params.actorId),
        isNull(impersonationWindows.endedAt),
        gt(impersonationWindows.deadlineAt, params.now),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

export async function requireImpersonationWindowCapacity(
  params: ImpersonationWindowActorTimeParams,
  executor?: ImpersonationWindowExecutor,
): Promise<void>;
export async function requireImpersonationWindowCapacity(
  executor: ImpersonationWindowExecutor,
  params: ImpersonationWindowActorTimeParams,
): Promise<void>;
export async function requireImpersonationWindowCapacity(
  first: ImpersonationWindowActorTimeParams | ImpersonationWindowExecutor,
  second?: ImpersonationWindowActorTimeParams | ImpersonationWindowExecutor,
): Promise<void> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  await materializeExpiredImpersonationWindows(executor, params);
  const openCount = await countOpenImpersonationWindows(executor, params);
  if (openCount >= MAX_OPEN_IMPERSONATION_WINDOWS) {
    throw new ImpersonationWindowLimitReachedError();
  }
}

export const assertImpersonationWindowCapacity = requireImpersonationWindowCapacity;

export async function stopImpersonationWindow(
  params: StopImpersonationWindowParams,
  executor?: ImpersonationWindowExecutor,
): Promise<ImpersonationWindow | undefined>;
export async function stopImpersonationWindow(
  executor: ImpersonationWindowExecutor,
  params: StopImpersonationWindowParams,
): Promise<ImpersonationWindow | undefined>;
export async function stopImpersonationWindow(
  first: StopImpersonationWindowParams | ImpersonationWindowExecutor,
  second?: StopImpersonationWindowParams | ImpersonationWindowExecutor,
): Promise<ImpersonationWindow | undefined> {
  const {executor, params} = resolveExecutorAndParams(first, second);
  const rows = await executor
    .update(impersonationWindows)
    .set({
      endedAt: sql`CASE
        WHEN ${impersonationWindows.deadlineAt} <= ${params.now}
          THEN ${impersonationWindows.deadlineAt}
        ELSE ${params.endedAt}
      END`,
      endedReason: sql`CASE
        WHEN ${impersonationWindows.deadlineAt} <= ${params.now}
          THEN 'expired'
        ELSE 'stopped'
      END`,
    })
    .where(and(eq(impersonationWindows.id, params.id), isNull(impersonationWindows.endedAt)))
    .returning();
  const row = rows[0];
  return row ? toImpersonationWindow(row) : undefined;
}

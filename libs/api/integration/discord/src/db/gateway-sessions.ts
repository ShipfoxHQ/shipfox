import {eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {discordGatewaySessions, toDiscordGatewaySession} from './schema/gateway-sessions.js';

export interface DiscordGatewaySession {
  shardId: number;
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  /** Diagnostics only. The library advances it before our handler publishes, so never resume from it. */
  receivedSequence: number | null;
  /** The resume point: every dispatch up to here was published or skipped on purpose. */
  committedSequence: number | null;
  updatedAt: Date;
}

export interface StartDiscordGatewaySessionParams {
  shardId: number;
  sessionId: string;
  resumeGatewayUrl: string;
}

export interface FlushDiscordGatewaySessionParams {
  shardId: number;
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  receivedSequence: number | null;
  committedSequence: number | null;
}

export async function getDiscordGatewaySession(params: {
  shardId: number;
}): Promise<DiscordGatewaySession | undefined> {
  const rows = await db()
    .select()
    .from(discordGatewaySessions)
    .where(eq(discordGatewaySessions.shardId, params.shardId))
    .limit(1);
  return rows[0] ? toDiscordGatewaySession(rows[0]) : undefined;
}

/** Records a new session and resets both cursors, since sequences restart with the session. */
export async function startDiscordGatewaySession(
  params: StartDiscordGatewaySessionParams,
): Promise<DiscordGatewaySession> {
  const values = {
    shardId: params.shardId,
    sessionId: params.sessionId,
    resumeGatewayUrl: params.resumeGatewayUrl,
    receivedSequence: 0,
    committedSequence: 0,
    updatedAt: new Date(),
  };
  const [row] = await db()
    .insert(discordGatewaySessions)
    .values(values)
    .onConflictDoUpdate({target: discordGatewaySessions.shardId, set: values})
    .returning();
  if (!row) throw new Error(`Discord gateway session was not written for shard ${params.shardId}`);
  return toDiscordGatewaySession(row);
}

/**
 * Writes the session fields and both cursors in one statement. Within one session the committed
 * cursor never goes down. A different session id replaces the stored cursor, and a null session id
 * clears the row.
 */
export async function flushDiscordGatewaySession(
  params: FlushDiscordGatewaySessionParams,
): Promise<DiscordGatewaySession> {
  const cleared = params.sessionId === null;
  const values = {
    shardId: params.shardId,
    sessionId: params.sessionId,
    resumeGatewayUrl: cleared ? null : params.resumeGatewayUrl,
    receivedSequence: cleared ? null : params.receivedSequence,
    committedSequence: cleared ? null : params.committedSequence,
    updatedAt: new Date(),
  };
  const [row] = await db()
    .insert(discordGatewaySessions)
    .values(values)
    .onConflictDoUpdate({
      target: discordGatewaySessions.shardId,
      set: {
        ...values,
        committedSequence: cleared
          ? null
          : sql`CASE WHEN ${discordGatewaySessions.sessionId} = excluded.session_id THEN GREATEST(${discordGatewaySessions.committedSequence}, excluded.committed_sequence) ELSE excluded.committed_sequence END`,
      },
    })
    .returning();
  if (!row) throw new Error(`Discord gateway session was not written for shard ${params.shardId}`);
  return toDiscordGatewaySession(row);
}

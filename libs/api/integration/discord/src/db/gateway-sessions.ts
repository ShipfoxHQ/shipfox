import {and, eq, sql} from 'drizzle-orm';
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

/**
 * Records a session. A session id that differs from the stored one resets both cursors, since
 * sequences restart with the session. The same session id keeps the stored cursors.
 */
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
    .onConflictDoUpdate({
      target: discordGatewaySessions.shardId,
      set: {
        sessionId: values.sessionId,
        resumeGatewayUrl: values.resumeGatewayUrl,
        receivedSequence: sql`CASE WHEN ${discordGatewaySessions.sessionId} = excluded.session_id THEN ${discordGatewaySessions.receivedSequence} ELSE excluded.received_sequence END`,
        committedSequence: sql`CASE WHEN ${discordGatewaySessions.sessionId} = excluded.session_id THEN ${discordGatewaySessions.committedSequence} ELSE excluded.committed_sequence END`,
        updatedAt: values.updatedAt,
      },
    })
    .returning();
  if (!row) throw new Error(`Discord gateway session was not written for shard ${params.shardId}`);
  return toDiscordGatewaySession(row);
}

/**
 * Writes the session fields and both cursors in one statement, only while the stored session id
 * matches. A late flush from a replaced session is therefore a no-op and returns undefined.
 * Within a session the committed cursor never goes down. A null session id clears the row.
 */
export async function flushDiscordGatewaySession(
  params: FlushDiscordGatewaySessionParams,
): Promise<DiscordGatewaySession | undefined> {
  const shard = eq(discordGatewaySessions.shardId, params.shardId);
  const [row] =
    params.sessionId === null
      ? await db()
          .update(discordGatewaySessions)
          .set({
            sessionId: null,
            resumeGatewayUrl: null,
            receivedSequence: null,
            committedSequence: null,
            updatedAt: new Date(),
          })
          .where(shard)
          .returning()
      : await db()
          .update(discordGatewaySessions)
          .set({
            resumeGatewayUrl: params.resumeGatewayUrl,
            receivedSequence: params.receivedSequence,
            committedSequence: sql`GREATEST(${discordGatewaySessions.committedSequence}, ${params.committedSequence})`,
            updatedAt: new Date(),
          })
          .where(and(shard, eq(discordGatewaySessions.sessionId, params.sessionId)))
          .returning();
  return row ? toDiscordGatewaySession(row) : undefined;
}

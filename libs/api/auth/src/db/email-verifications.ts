import {AUTH_EMAIL_VERIFICATION_SEND_REQUESTED, type AuthEventMap} from '@shipfox/api-auth-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, desc, eq, gt, isNull, sql} from 'drizzle-orm';
import type {EmailVerification} from '#core/entities/email-verification.js';
import type {User} from '#core/entities/user.js';
import {db} from './db.js';
import {emailVerifications, toEmailVerification} from './schema/email-verifications.js';
import {authOutbox} from './schema/outbox.js';
import {toUser, users} from './schema/users.js';

interface CreateEmailVerificationBaseParams {
  userId: string;
  hashedToken: string;
  expiresAt: Date;
}

export type CreateEmailVerificationParams = CreateEmailVerificationBaseParams &
  (
    | {sendEmail: {email: string; verifyLink: string}; skipEmail?: never}
    | {sendEmail?: never; skipEmail: true}
  );

export async function createEmailVerification(
  params: CreateEmailVerificationParams,
): Promise<EmailVerification> {
  return await db().transaction(async (tx) => {
    await tx
      .update(emailVerifications)
      .set({usedAt: sql`now()`})
      .where(and(eq(emailVerifications.userId, params.userId), isNull(emailVerifications.usedAt)));

    const rows = await tx
      .insert(emailVerifications)
      .values({
        userId: params.userId,
        hashedToken: params.hashedToken,
        expiresAt: params.expiresAt,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    if (params.sendEmail) {
      await writeOutboxEvent<AuthEventMap>(tx, authOutbox, {
        type: AUTH_EMAIL_VERIFICATION_SEND_REQUESTED,
        payload: params.sendEmail,
      });
    }
    return toEmailVerification(row);
  });
}

export interface CreateResendEmailVerificationParams {
  email: string;
  hashedToken: string;
  expiresAt: Date;
  cooldownSeconds: number;
  sendEmail: {verifyLink: string};
  now?: Date | undefined;
}

export interface CreateResendEmailVerificationResult {
  user?: User | undefined;
  verification?: EmailVerification | undefined;
  nextResendAvailableAt: Date;
}

function secondsAfter(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export async function createResendEmailVerification(
  params: CreateResendEmailVerificationParams,
): Promise<CreateResendEmailVerificationResult> {
  const now = params.now ?? new Date();
  const genericNextResendAvailableAt = secondsAfter(now, params.cooldownSeconds);

  return await db().transaction(async (tx) => {
    const userRows = await tx
      .select()
      .from(users)
      .where(eq(users.email, params.email))
      .limit(1)
      .for('update');
    const userRow = userRows[0];
    if (!userRow) {
      return {nextResendAvailableAt: genericNextResendAvailableAt};
    }

    const user = toUser(userRow);
    if (user.status !== 'active' || user.emailVerifiedAt !== null) {
      return {nextResendAvailableAt: genericNextResendAvailableAt};
    }

    const latestRows = await tx
      .select()
      .from(emailVerifications)
      .where(and(eq(emailVerifications.userId, user.id), isNull(emailVerifications.usedAt)))
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);
    const latest = latestRows[0] ? toEmailVerification(latestRows[0]) : undefined;
    if (latest && secondsAfter(latest.createdAt, params.cooldownSeconds) > now) {
      // Return the same public retry estimate as no-op cases so the endpoint does
      // not expose existing account state or prior verification timing.
      return {user, nextResendAvailableAt: genericNextResendAvailableAt};
    }

    await tx
      .update(emailVerifications)
      .set({usedAt: sql`now()`})
      .where(and(eq(emailVerifications.userId, user.id), isNull(emailVerifications.usedAt)));

    const rows = await tx
      .insert(emailVerifications)
      .values({
        userId: user.id,
        hashedToken: params.hashedToken,
        expiresAt: params.expiresAt,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    const verification = toEmailVerification(row);
    if (params.sendEmail) {
      await writeOutboxEvent<AuthEventMap>(tx, authOutbox, {
        type: AUTH_EMAIL_VERIFICATION_SEND_REQUESTED,
        payload: {
          email: user.email,
          verifyLink: params.sendEmail.verifyLink,
        },
      });
    }
    return {
      user,
      verification,
      nextResendAvailableAt: secondsAfter(verification.createdAt, params.cooldownSeconds),
    };
  });
}

export async function consumeEmailVerification(params: {
  hashedToken: string;
}): Promise<EmailVerification | undefined> {
  const rows = await db()
    .update(emailVerifications)
    .set({usedAt: sql`now()`})
    .where(
      and(
        eq(emailVerifications.hashedToken, params.hashedToken),
        isNull(emailVerifications.usedAt),
        gt(emailVerifications.expiresAt, sql`now()`),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toEmailVerification(row);
}

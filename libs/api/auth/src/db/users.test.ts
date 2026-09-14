import {AUTH_USER_SIGNED_UP} from '@shipfox/api-auth-dto';
import * as outbox from '@shipfox/node-outbox';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, sql} from 'drizzle-orm';
import {EmailTakenError} from '#core/errors.js';
import {db} from './db.js';
import {authOutbox} from './schema/outbox.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  provisionUser,
  updateUserPassword,
} from './users.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

describe('users db', () => {
  test('creates a user with email_verified_at null and finds by email and id', async () => {
    const email = emailFor('alice');

    const user = await createUser({email, hashedPassword: 'h', name: 'Alice'});
    const byEmail = await findUserByEmail({email});
    const byId = await findUserById({id: user.id});

    expect(user.id).toBeDefined();
    expect(user.email).toBe(email);
    expect(user.emailVerifiedAt).toBeNull();
    expect(byEmail?.id).toBe(user.id);
    expect(byId?.id).toBe(user.id);
  });

  test('creates a user with email_verified_at set when provided', async () => {
    const emailVerifiedAt = new Date('2026-01-01T00:00:00.000Z');

    const user = await createUser({
      email: emailFor('verified-insert'),
      hashedPassword: 'h',
      emailVerifiedAt,
    });

    expect(user.emailVerifiedAt).toEqual(emailVerifiedAt);
  });

  test('rejects duplicate email', async () => {
    const email = emailFor('dup');
    await createUser({email, hashedPassword: 'h'});

    await expect(createUser({email, hashedPassword: 'h2'})).rejects.toThrow();
  });

  test('remaps email unique violation to EmailTakenError', async () => {
    const email = emailFor('race');
    await createUser({email, hashedPassword: 'h'});

    await expect(createUser({email, hashedPassword: 'h2'})).rejects.toBeInstanceOf(EmailTakenError);
  });

  test('rolls back a provisioned user when its signup event cannot be written', async () => {
    const email = emailFor('provision-event-failure');
    const failure = new Error('outbox unavailable');
    const actualWriteOutboxEvent = outbox.writeOutboxEvent;
    vi.spyOn(outbox, 'writeOutboxEvent').mockImplementationOnce(async (...args) => {
      await actualWriteOutboxEvent(...args);
      throw failure;
    });

    const failedProvision = provisionUser({email, viaInvitation: false});

    await expect(failedProvision).rejects.toBe(failure);
    const rolledBackUser = await findUserByEmail({email});
    const rolledBackEvents = await db()
      .select()
      .from(authOutbox)
      .where(
        and(
          eq(authOutbox.eventType, AUTH_USER_SIGNED_UP),
          sql`${authOutbox.payload}->>'email' = ${email}`,
        ),
      );

    expect(rolledBackUser).toBeUndefined();
    expect(rolledBackEvents).toHaveLength(0);

    const user = await provisionUser({email, viaInvitation: false});
    const events = await db()
      .select()
      .from(authOutbox)
      .where(
        and(
          eq(authOutbox.eventType, AUTH_USER_SIGNED_UP),
          sql`${authOutbox.payload}->>'email' = ${email}`,
        ),
      );

    expect(user.email).toBe(email);
    expect(events).toHaveLength(1);
  });

  test('updateUserPassword updates the hashed password', async () => {
    const user = await createUser({email: emailFor('pwbump'), hashedPassword: 'old'});

    const updated = await updateUserPassword({userId: user.id, hashedPassword: 'new'});

    expect(updated?.hashedPassword).toBe('new');
  });

  test('markEmailVerified sets emailVerifiedAt', async () => {
    const user = await createUser({email: emailFor('verify'), hashedPassword: 'h'});

    const verified = await markEmailVerified({userId: user.id});

    expect(verified?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  test('opaque token helpers remain available', () => {
    expect(typeof hashOpaqueToken).toBe('function');
  });
});

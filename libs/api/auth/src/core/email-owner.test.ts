import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import {ZodError} from 'zod';
import {findUserByEmail} from '#core/email-owner.js';
import {db} from '#db/db.js';
import {emailVerifications} from '#db/schema/email-verifications.js';
import {refreshTokens} from '#db/schema/refresh-tokens.js';
import {users} from '#db/schema/users.js';
import * as usersDb from '#db/users.js';
import {userFactory} from '#test/index.js';

describe('findUserByEmail (email owner)', () => {
  test('returns undefined for a missing owner', async () => {
    const result = await findUserByEmail({
      email: `missing-${crypto.randomUUID()}@example.com`,
    });

    expect(result).toBeUndefined();
  });

  test.each([
    'active',
    'suspended',
    'deleted',
  ] as const)('returns the owner of a(n) %s account', async (status) => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    await db().update(users).set({status}).where(eq(users.id, user.id));

    const result = await findUserByEmail({email: user.email});

    expect(result).toEqual({id: user.id, email: user.email, status});
  });

  test('projects only id, email, and status', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});

    const result = await findUserByEmail({email: user.email});

    expect(Object.keys(result ?? {}).sort()).toEqual(['email', 'id', 'status']);
  });

  test('resolves surrounding whitespace and mixed case to the same owner', async () => {
    const user = await userFactory.create();

    const result = await findUserByEmail({email: `  ${user.email.toUpperCase()}  `});

    expect(result).toEqual({id: user.id, email: user.email, status: 'active'});
  });

  test('performs no user, refresh-session, or email-verification writes', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const rawRefreshToken = generateOpaqueToken('refreshToken');
    await db()
      .insert(refreshTokens)
      .values({
        userId: user.id,
        hashedToken: hashOpaqueToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + 60_000),
      });
    const rawVerificationToken = generateOpaqueToken('emailVerification');
    await db()
      .insert(emailVerifications)
      .values({
        userId: user.id,
        hashedToken: hashOpaqueToken(rawVerificationToken),
        expiresAt: new Date(Date.now() + 60_000),
      });

    const beforeUser = await db().select().from(users).where(eq(users.id, user.id));
    const beforeRefreshTokens = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    const beforeEmailVerifications = await db()
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, user.id));

    await findUserByEmail({email: user.email});

    const afterUser = await db().select().from(users).where(eq(users.id, user.id));
    const afterRefreshTokens = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    const afterEmailVerifications = await db()
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, user.id));

    expect(afterUser).toEqual(beforeUser);
    expect(afterRefreshTokens).toEqual(beforeRefreshTokens);
    expect(afterEmailVerifications).toEqual(beforeEmailVerifications);
  });

  test('rejects invalid email syntax without querying the database', async () => {
    const findUserByEmailInDbSpy = vi.spyOn(usersDb, 'findUserByEmail');

    const promise = findUserByEmail({email: 'not-an-email'});

    await expect(promise).rejects.toBeInstanceOf(ZodError);
    expect(findUserByEmailInDbSpy).not.toHaveBeenCalled();
  });
});

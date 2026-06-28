import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {mintEphemeralRegistrationToken} from './ephemeral-registration-tokens.js';

describe('mintEphemeralRegistrationToken', () => {
  beforeEach(async () => {
    await db().execute(sql`TRUNCATE runners_ephemeral_registration_tokens CASCADE`);
  });

  it('mints a token, stores only the hash, and carries the ert prefix', async () => {
    const workspaceId = crypto.randomUUID();
    const provisionerId = crypto.randomUUID();

    const result = await mintEphemeralRegistrationToken({
      workspaceId,
      provisionerId,
      resourceId: 'gh-runner-7',
      ttlSeconds: 600,
    });

    expect(result.rawToken.startsWith(`sf_${tokenTypeParts.ephemeralRegistrationToken}_`)).toBe(
      true,
    );
    expect(result.token.workspaceId).toBe(workspaceId);
    expect(result.token.provisionerId).toBe(provisionerId);
    expect(result.token.resourceId).toBe('gh-runner-7');
    expect(result.token.reservationId).toBeNull();
    expect(result.token.prefix).toBe(result.rawToken.slice(0, 12));
    const [row] = await db()
      .select()
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.id, result.token.id));
    expect(row?.hashedToken).toBe(hashOpaqueToken(result.rawToken));
    expect(row?.hashedToken).not.toBe(result.rawToken);
  });

  it('derives expiresAt from ttlSeconds', async () => {
    const ttlSeconds = 900;
    const before = Date.now();

    const result = await mintEphemeralRegistrationToken({
      workspaceId: crypto.randomUUID(),
      provisionerId: crypto.randomUUID(),
      resourceId: 'gh-runner-7',
      ttlSeconds,
    });

    const after = Date.now();
    const expiresMs = result.token.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + ttlSeconds * 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + ttlSeconds * 1000);
  });

  it('passes through a reservationId when provided', async () => {
    const reservationId = crypto.randomUUID();

    const result = await mintEphemeralRegistrationToken({
      workspaceId: crypto.randomUUID(),
      provisionerId: crypto.randomUUID(),
      resourceId: 'gh-runner-7',
      reservationId,
      ttlSeconds: 600,
    });

    expect(result.token.reservationId).toBe(reservationId);
  });
});

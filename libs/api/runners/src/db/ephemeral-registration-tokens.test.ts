import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {sql} from 'drizzle-orm';
import {ActiveEphemeralRegistrationTokensExistError} from '#core/errors.js';
import {db} from '#db/db.js';
import {
  createEphemeralRegistrationTokensBatch,
  resolveEphemeralRegistrationTokenByHash,
} from '#db/ephemeral-registration-tokens.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {ephemeralRegistrationTokenFactory} from '#test/index.js';

describe('createEphemeralRegistrationTokensBatch', () => {
  let workspaceId: string;
  let provisionerId: string;
  let reservationId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_reservations CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
    reservationId = await createReservation({count: 3});
  });

  it('persists all rows for the reservation in one batch', async () => {
    const rawTokens = [
      generateOpaqueToken('ephemeralRegistrationToken'),
      generateOpaqueToken('ephemeralRegistrationToken'),
    ];
    const expiresAt = new Date(Date.now() + 300_000);

    const result = await createEphemeralRegistrationTokensBatch({
      workspaceId,
      provisionerId,
      reservationId,
      expiresAt,
      rows: [
        row('provisioned-runner-a', rawTokens[0] ?? ''),
        row('provisioned-runner-b', rawTokens[1] ?? ''),
      ],
    });

    expect(result).toHaveLength(2);
    expect(result.map((token) => token.provisionedRunnerId).sort()).toEqual([
      'provisioned-runner-a',
      'provisioned-runner-b',
    ]);
    expect(result.every((token) => token.reservationId === reservationId)).toBe(true);
    expect(result.every((token) => token.workspaceId === workspaceId)).toBe(true);
    expect(result.every((token) => token.provisionerId === provisionerId)).toBe(true);
    expect(
      await resolveEphemeralRegistrationTokenByHash(hashOpaqueToken(rawTokens[0] ?? '')),
    ).toEqual(expect.objectContaining({provisionedRunnerId: 'provisioned-runner-a'}));
  });

  it('rejects the batch and inserts no rows when any provisioned runner already has an active token', async () => {
    await ephemeralRegistrationTokenFactory.create({
      workspaceId,
      provisionerId,
      provisionedRunnerId: 'provisioned-runner-a',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const rawToken = generateOpaqueToken('ephemeralRegistrationToken');

    await expect(
      createEphemeralRegistrationTokensBatch({
        workspaceId,
        provisionerId,
        reservationId,
        expiresAt: new Date(Date.now() + 300_000),
        rows: [row('provisioned-runner-a', rawToken), row('provisioned-runner-b', rawToken)],
      }),
    ).rejects.toBeInstanceOf(ActiveEphemeralRegistrationTokensExistError);

    const rows = await db().select().from(ephemeralRegistrationTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provisionedRunnerId).toBe('provisioned-runner-a');
  });

  async function createReservation(params: {count: number}): Promise<string> {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: params.count,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Insert returned no rows');
    return reservation.id;
  }

  function row(provisionedRunnerId: string, rawToken: string) {
    return {
      provisionedRunnerId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: extractDisplayPrefix(rawToken),
    };
  }
});

import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import {manualRegistrationTokenFactory} from '#test/index.js';
import {db} from './db.js';
import {
  createManualRegistrationToken,
  listUsableManualRegistrationTokensByWorkspaceId,
  resolveManualRegistrationTokenByHash,
  revokeManualRegistrationToken,
} from './manual-registration-tokens.js';
import {manualRegistrationTokens} from './schema/manual-registration-tokens.js';

describe('manual registration tokens', () => {
  it('creates a manual registration token with a hashed token and prefix', async () => {
    const rawToken = 'sf_mrt_test-token';
    const workspaceId = crypto.randomUUID();

    const token = await createManualRegistrationToken({
      workspaceId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: rawToken.slice(0, 12),
      name: 'build runner',
    });

    expect(token.workspaceId).toBe(workspaceId);
    expect(token.hashedToken).toBe(hashOpaqueToken(rawToken));
    expect(token.hashedToken).not.toBe(rawToken);
    expect(token.prefix).toBe(rawToken.slice(0, 12));
    expect(token.name).toBe('build runner');
  });

  it('resolves a manual registration token by hash', async () => {
    const rawToken = 'sf_mrt_resolve-token';
    const created = await manualRegistrationTokenFactory.create({}, {transient: {rawToken}});

    const resolved = await resolveManualRegistrationTokenByHash(hashOpaqueToken(rawToken));

    expect(resolved?.id).toBe(created.id);
  });

  it('returns undefined for an unknown token hash', async () => {
    const resolved = await resolveManualRegistrationTokenByHash(hashOpaqueToken('missing'));

    expect(resolved).toBeUndefined();
  });

  it('revokes only tokens for the requested workspace', async () => {
    const ownWorkspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const token = await manualRegistrationTokenFactory.create({workspaceId: ownWorkspaceId});

    const crossWorkspaceResult = await revokeManualRegistrationToken({
      tokenId: token.id,
      workspaceId: otherWorkspaceId,
    });
    const ownWorkspaceResult = await revokeManualRegistrationToken({
      tokenId: token.id,
      workspaceId: ownWorkspaceId,
    });

    expect(crossWorkspaceResult).toBeUndefined();
    expect(ownWorkspaceResult?.revokedAt).toBeInstanceOf(Date);
  });

  it('lists only currently usable tokens for a workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const usable = await manualRegistrationTokenFactory.create({workspaceId, name: 'usable'});
    const expired = await manualRegistrationTokenFactory.create({
      workspaceId,
      name: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const revoked = await manualRegistrationTokenFactory.create({workspaceId, name: 'revoked'});
    await manualRegistrationTokenFactory.create({
      workspaceId: crypto.randomUUID(),
      name: 'other workspace',
    });
    await revokeManualRegistrationToken({tokenId: revoked.id, workspaceId});

    const tokens = await listUsableManualRegistrationTokensByWorkspaceId(workspaceId);

    expect(tokens.map((token) => token.id)).toEqual([usable.id]);
    expect(tokens.map((token) => token.id)).not.toContain(expired.id);
    expect(tokens[0]?.revokedAt).toBeNull();
  });

  it('stores only the token hash', async () => {
    const rawToken = 'sf_mrt_raw-ret';

    await manualRegistrationTokenFactory.create({}, {transient: {rawToken}});

    const rows = await db()
      .select()
      .from(manualRegistrationTokens)
      .where(eq(manualRegistrationTokens.prefix, rawToken.slice(0, 12)));
    expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(rawToken));
    expect(rows[0]?.hashedToken).not.toBe(rawToken);
  });
});

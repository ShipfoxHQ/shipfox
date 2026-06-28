import {hashOpaqueToken} from '@shipfox/node-tokens';
import {sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  createProvisionerToken,
  listUsableProvisionerTokensByWorkspaceId,
  resolveProvisionerTokenByHash,
  revokeProvisionerToken,
} from '#db/provisioner-tokens.js';
import {provisionerTokenFactory} from '#test/index.js';

describe('provisioner token db', () => {
  beforeEach(async () => {
    await db().execute(sql`TRUNCATE provisioners_provisioner_tokens CASCADE`);
  });

  it('creates and resolves a token', async () => {
    const workspaceId = await createWorkspace();
    const rawToken = 'sf_pt_test-token';
    const createdByUserId = crypto.randomUUID();
    const token = await createProvisionerToken({
      workspaceId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: rawToken.slice(0, 12),
      name: 'scaler',
      createdByUserId,
    });

    const result = await resolveProvisionerTokenByHash(hashOpaqueToken(rawToken));

    expect(result?.id).toBe(token.id);
    expect(result?.workspaceId).toBe(workspaceId);
    expect(result?.createdByUserId).toBe(createdByUserId);
  });

  it('returns undefined when resolving an unknown token hash', async () => {
    const result = await resolveProvisionerTokenByHash(hashOpaqueToken('sf_pt_unknown-token'));

    expect(result).toBeUndefined();
  });

  it('lists usable tokens for a workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const usable = await provisionerTokenFactory.create({workspaceId, name: 'usable'});
    const expired = await provisionerTokenFactory.create({
      workspaceId,
      name: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const revoked = await provisionerTokenFactory.create({workspaceId, name: 'revoked'});
    await provisionerTokenFactory.create({
      workspaceId: crypto.randomUUID(),
      name: 'other workspace',
    });
    await revokeProvisionerToken({
      tokenId: revoked.id,
      workspaceId,
      revokedByUserId: crypto.randomUUID(),
    });

    const tokens = await listUsableProvisionerTokensByWorkspaceId(workspaceId);

    expect(tokens.map((token) => token.id)).toEqual([usable.id]);
    expect(tokens.map((token) => token.id)).not.toContain(expired.id);
  });

  it('revokes a token and records the revoking user', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await provisionerTokenFactory.create({workspaceId});
    const revokedByUserId = crypto.randomUUID();

    const revoked = await revokeProvisionerToken({tokenId: token.id, workspaceId, revokedByUserId});

    expect(revoked?.id).toBe(token.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(revoked?.revokedByUserId).toBe(revokedByUserId);
  });

  it('preserves the original revocation audit fields on repeat revoke', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await provisionerTokenFactory.create({workspaceId});
    const firstRevokedByUserId = crypto.randomUUID();
    const secondRevokedByUserId = crypto.randomUUID();

    const first = await revokeProvisionerToken({
      tokenId: token.id,
      workspaceId,
      revokedByUserId: firstRevokedByUserId,
    });
    const second = await revokeProvisionerToken({
      tokenId: token.id,
      workspaceId,
      revokedByUserId: secondRevokedByUserId,
    });

    expect(second?.id).toBe(token.id);
    expect(second?.revokedAt?.toISOString()).toBe(first?.revokedAt?.toISOString());
    expect(second?.revokedByUserId).toBe(firstRevokedByUserId);
  });
});

async function createWorkspace(params?: {status?: 'active' | 'suspended' | 'deleted'}) {
  const id = crypto.randomUUID();
  await db().execute(
    sql`INSERT INTO workspaces (id, name, status) VALUES (${id}, 'Test Workspace', ${
      params?.status ?? 'active'
    })`,
  );
  return id;
}

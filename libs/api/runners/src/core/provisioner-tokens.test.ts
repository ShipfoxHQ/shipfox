import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {provisionerTokenFactory} from '#test/index.js';
import {
  createWorkspaceProvisionerToken,
  listUsableProvisionerTokens,
  revokeWorkspaceProvisionerToken,
} from './provisioner-tokens.js';

describe('provisioner token core', () => {
  it('creates a workspace provisioner token and stores only the hash', async () => {
    const workspaceId = crypto.randomUUID();
    const createdByUserId = crypto.randomUUID();

    const result = await createWorkspaceProvisionerToken({
      workspaceId,
      createdByUserId,
      name: 'local provisioner',
      ttlSeconds: 3600,
    });

    expect(result.rawToken.startsWith(`sf_${tokenTypeParts.provisionerToken}_`)).toBe(true);
    expect(result.token.workspaceId).toBe(workspaceId);
    expect(result.token.createdByUserId).toBe(createdByUserId);
    expect(result.token.expiresAt).toBeInstanceOf(Date);
    expect(result.token.prefix).toBe(result.rawToken.slice(0, 12));
    const rows = await db()
      .select()
      .from(provisionerTokens)
      .where(eq(provisionerTokens.id, result.token.id));
    expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(result.rawToken));
    expect(rows[0]?.hashedToken).not.toBe(result.rawToken);
  });

  it('lists usable tokens and excludes revoked tokens after revoke', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await provisionerTokenFactory.create({workspaceId});
    const revokedByUserId = crypto.randomUUID();

    const beforeRevoke = await listUsableProvisionerTokens(workspaceId);
    await revokeWorkspaceProvisionerToken({tokenId: token.id, workspaceId, revokedByUserId});
    const afterRevoke = await listUsableProvisionerTokens(workspaceId);

    expect(beforeRevoke.map((item) => item.id)).toEqual([token.id]);
    expect(afterRevoke).toEqual([]);
  });

  it('throws when revoking a token outside the workspace', async () => {
    const token = await provisionerTokenFactory.create({workspaceId: crypto.randomUUID()});

    const result = revokeWorkspaceProvisionerToken({
      tokenId: token.id,
      workspaceId: crypto.randomUUID(),
      revokedByUserId: crypto.randomUUID(),
    });

    await expect(result).rejects.toThrow(`Provisioner token not found: ${token.id}`);
  });
});

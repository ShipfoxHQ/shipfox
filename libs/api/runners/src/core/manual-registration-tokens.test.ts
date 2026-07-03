import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {manualRegistrationTokens} from '#db/schema/manual-registration-tokens.js';
import {manualRegistrationTokenFactory} from '#test/index.js';
import {
  createWorkspaceManualRegistrationToken,
  listUsableManualRegistrationTokens,
  revokeWorkspaceManualRegistrationToken,
} from './manual-registration-tokens.js';

describe('manual registration token core', () => {
  it('creates a workspace manual registration token and stores only the hash', async () => {
    const workspaceId = crypto.randomUUID();

    const result = await createWorkspaceManualRegistrationToken({
      workspaceId,
      name: 'local runner',
      ttlSeconds: 3600,
    });

    expect(result.rawToken.startsWith(`sf_${tokenTypeParts.manualRegistrationToken}_`)).toBe(true);
    expect(result.token.workspaceId).toBe(workspaceId);
    expect(result.token.prefix).toBe(result.rawToken.slice(0, 12));
    const rows = await db()
      .select()
      .from(manualRegistrationTokens)
      .where(eq(manualRegistrationTokens.id, result.token.id));
    expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(result.rawToken));
    expect(rows[0]?.hashedToken).not.toBe(result.rawToken);
  });

  it('lists usable tokens and excludes revoked tokens after revoke', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await manualRegistrationTokenFactory.create({workspaceId});

    const beforeRevoke = await listUsableManualRegistrationTokens(workspaceId);
    await revokeWorkspaceManualRegistrationToken({tokenId: token.id, workspaceId});
    const afterRevoke = await listUsableManualRegistrationTokens(workspaceId);

    expect(beforeRevoke.map((item) => item.id)).toEqual([token.id]);
    expect(afterRevoke).toEqual([]);
  });
});

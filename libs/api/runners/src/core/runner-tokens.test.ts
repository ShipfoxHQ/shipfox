import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {runnerTokens} from '#db/schema/runner-tokens.js';
import {runnerTokenFactory} from '#test/index.js';
import {
  createWorkspaceRunnerToken,
  listUsableRunnerTokens,
  revokeWorkspaceRunnerToken,
} from './runner-tokens.js';

describe('runner token core', () => {
  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_runner_tokens CASCADE`,
    );
  });

  it('creates a workspace runner token and stores only the hash', async () => {
    const workspaceId = crypto.randomUUID();

    const result = await createWorkspaceRunnerToken({
      workspaceId,
      name: 'local runner',
      ttlSeconds: 3600,
    });

    expect(result.rawToken.startsWith(`sf_${tokenTypeParts.runnerToken}_`)).toBe(true);
    expect(result.token.workspaceId).toBe(workspaceId);
    expect(result.token.prefix).toBe(result.rawToken.slice(0, 12));
    const rows = await db().select().from(runnerTokens).where(eq(runnerTokens.id, result.token.id));
    expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(result.rawToken));
    expect(rows[0]?.hashedToken).not.toBe(result.rawToken);
  });

  it('lists usable tokens and excludes revoked tokens after revoke', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await runnerTokenFactory.create({workspaceId});

    const beforeRevoke = await listUsableRunnerTokens(workspaceId);
    await revokeWorkspaceRunnerToken({tokenId: token.id, workspaceId});
    const afterRevoke = await listUsableRunnerTokens(workspaceId);

    expect(beforeRevoke.map((item) => item.id)).toEqual([token.id]);
    expect(afterRevoke).toEqual([]);
  });
});

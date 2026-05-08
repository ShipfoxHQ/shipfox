import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {runnerTokenFactory} from '#test/index.js';
import {db} from './db.js';
import {
  createRunnerToken,
  listUsableRunnerTokensByWorkspaceId,
  resolveRunnerTokenByHash,
  revokeRunnerToken,
} from './runner-tokens.js';
import {runnerTokens} from './schema/runner-tokens.js';

describe('runner tokens', () => {
  beforeEach(async () => {
    await db().execute(sql`TRUNCATE runners_runner_tokens CASCADE`);
  });

  it('creates a runner token with a hashed token and prefix', async () => {
    const rawToken = 'sf_r_test-token';
    const workspaceId = crypto.randomUUID();

    const token = await createRunnerToken({
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

  it('resolves a runner token by hash', async () => {
    const rawToken = 'sf_r_resolve-token';
    const created = await runnerTokenFactory.create({}, {transient: {rawToken}});

    const resolved = await resolveRunnerTokenByHash(hashOpaqueToken(rawToken));

    expect(resolved?.id).toBe(created.id);
  });

  it('returns undefined for an unknown token hash', async () => {
    const resolved = await resolveRunnerTokenByHash(hashOpaqueToken('missing'));

    expect(resolved).toBeUndefined();
  });

  it('revokes only tokens for the requested workspace', async () => {
    const ownWorkspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const token = await runnerTokenFactory.create({workspaceId: ownWorkspaceId});

    const crossWorkspaceResult = await revokeRunnerToken({
      tokenId: token.id,
      workspaceId: otherWorkspaceId,
    });
    const ownWorkspaceResult = await revokeRunnerToken({
      tokenId: token.id,
      workspaceId: ownWorkspaceId,
    });

    expect(crossWorkspaceResult).toBeUndefined();
    expect(ownWorkspaceResult?.revokedAt).toBeInstanceOf(Date);
  });

  it('lists only currently usable tokens for a workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const usable = await runnerTokenFactory.create({workspaceId, name: 'usable'});
    const expired = await runnerTokenFactory.create({
      workspaceId,
      name: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const revoked = await runnerTokenFactory.create({workspaceId, name: 'revoked'});
    await runnerTokenFactory.create({workspaceId: crypto.randomUUID(), name: 'other workspace'});
    await revokeRunnerToken({tokenId: revoked.id, workspaceId});

    const tokens = await listUsableRunnerTokensByWorkspaceId(workspaceId);

    expect(tokens.map((token) => token.id)).toEqual([usable.id]);
    expect(tokens.map((token) => token.id)).not.toContain(expired.id);
    expect(tokens[0]?.revokedAt).toBeNull();
  });

  it('stores only the token hash', async () => {
    const rawToken = 'sf_r_raw-secret';

    await runnerTokenFactory.create({}, {transient: {rawToken}});

    const rows = await db()
      .select()
      .from(runnerTokens)
      .where(eq(runnerTokens.prefix, 'sf_r_raw-sec'));
    expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(rawToken));
    expect(rows[0]?.hashedToken).not.toBe(rawToken);
  });
});

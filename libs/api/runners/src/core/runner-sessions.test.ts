import {verifyRunnerSessionToken} from '@shipfox/api-auth';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {runnerTokenFactory} from '#test/index.js';
import {EmptyRunnerLabelsError} from './errors.js';
import {registerRunnerSession} from './runner-sessions.js';

describe('registerRunnerSession', () => {
  let workspaceId: string;
  let registrationTokenId: string;

  beforeEach(async () => {
    await db().execute(sql`TRUNCATE runners_runner_sessions, runners_runner_tokens CASCADE`);
    workspaceId = crypto.randomUUID();
    const token = await runnerTokenFactory.create({workspaceId});
    registrationTokenId = token.id;
  });

  it('canonicalizes labels, stores them, and embeds them in the session token', async () => {
    const result = await registerRunnerSession({
      registrationTokenId,
      workspaceId,
      labels: [' Linux ', 'x64', 'linux'],
    });

    expect(result.mode).toBe('manual');
    expect(result.maxClaims).toBeNull();
    expect(result.session.labels).toEqual(['linux', 'x64']);

    const rows = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, result.session.id));
    expect(rows[0]?.labels).toEqual(['linux', 'x64']);

    const claims = await verifyRunnerSessionToken(result.sessionToken);
    expect(claims?.labels).toEqual(['linux', 'x64']);
  });

  it('throws EmptyRunnerLabelsError when labels canonicalize to empty', async () => {
    await expect(
      registerRunnerSession({registrationTokenId, workspaceId, labels: [' ', '\t']}),
    ).rejects.toBeInstanceOf(EmptyRunnerLabelsError);
  });
});

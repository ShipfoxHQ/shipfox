import {and, count, eq, isNull, lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {githubInstallations} from './schema/installations.js';
import {githubUnlinkedInstallations} from './schema/unlinked-installations.js';

type GithubDb = ReturnType<typeof db>;
type GithubTx = Parameters<Parameters<GithubDb['transaction']>[0]>[0];

type GithubUnlinkedInstallationExecutor = GithubDb | GithubTx;

export interface UpsertGithubUnlinkedInstallationParams {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  senderLogin: string | null;
  requesterLogin: string | null;
  lastAction: string;
}

export async function upsertGithubUnlinkedInstallation(
  params: UpsertGithubUnlinkedInstallationParams,
  options: {tx?: unknown} = {},
): Promise<void> {
  const executor = (options.tx ?? db()) as GithubUnlinkedInstallationExecutor;
  const now = new Date();

  await executor
    .insert(githubUnlinkedInstallations)
    .values({
      installationId: params.installationId,
      accountLogin: params.accountLogin,
      accountType: params.accountType,
      repositorySelection: params.repositorySelection,
      senderLogin: params.senderLogin,
      requesterLogin: params.requesterLogin,
      lastAction: params.lastAction,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: githubUnlinkedInstallations.installationId,
      set: {
        accountLogin: params.accountLogin,
        accountType: params.accountType,
        repositorySelection: params.repositorySelection,
        senderLogin: params.senderLogin,
        requesterLogin: params.requesterLogin,
        lastAction: params.lastAction,
        lastSeenAt: now,
      },
    });
}

export async function deleteGithubUnlinkedInstallationByInstallationId(
  installationId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as GithubUnlinkedInstallationExecutor;
  const result = await executor
    .delete(githubUnlinkedInstallations)
    .where(eq(githubUnlinkedInstallations.installationId, installationId));
  return (result.rowCount ?? 0) > 0;
}

export async function countStaleGithubUnlinkedInstallations(): Promise<number> {
  const [row] = await db()
    .select({value: count()})
    .from(githubUnlinkedInstallations)
    .leftJoin(
      githubInstallations,
      eq(githubInstallations.installationId, githubUnlinkedInstallations.installationId),
    )
    .where(
      and(
        lt(githubUnlinkedInstallations.firstSeenAt, sql`now() - interval '1 hour'`),
        isNull(githubInstallations.installationId),
      ),
    );
  return row?.value ?? 0;
}

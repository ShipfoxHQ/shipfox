import {and, eq, isNull, lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {githubInstallations} from './schema/installations.js';
import {githubUnlinkedInstallations} from './schema/unlinked-installations.js';

const UNLINKED_INSTALLATION_AGE_MS = 60 * 60 * 1000;

type GithubDb = ReturnType<typeof db>;
type GithubTx = Parameters<Parameters<GithubDb['transaction']>[0]>[0];

export interface UpsertGithubUnlinkedInstallationParams {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  senderLogin?: string | null | undefined;
  requesterLogin?: string | null | undefined;
  lastAction: string;
}

export async function upsertGithubUnlinkedInstallation(
  params: UpsertGithubUnlinkedInstallationParams,
  options: {tx?: unknown} = {},
): Promise<void> {
  const executor = (options.tx ?? db()) as GithubDb | GithubTx;
  const now = new Date();

  await executor
    .insert(githubUnlinkedInstallations)
    .values({
      installationId: params.installationId,
      accountLogin: params.accountLogin,
      accountType: params.accountType,
      repositorySelection: params.repositorySelection,
      senderLogin: params.senderLogin ?? null,
      requesterLogin: params.requesterLogin ?? null,
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
        senderLogin: params.senderLogin ?? null,
        requesterLogin: params.requesterLogin ?? null,
        lastAction: params.lastAction,
        lastSeenAt: now,
      },
    });
}

export async function deleteGithubUnlinkedInstallationByInstallationId(
  installationId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as GithubDb | GithubTx;
  const result = await executor
    .delete(githubUnlinkedInstallations)
    .where(eq(githubUnlinkedInstallations.installationId, installationId));
  return (result.rowCount ?? 0) > 0;
}

export async function countStaleGithubUnlinkedInstallations(): Promise<number> {
  const cutoff = new Date(Date.now() - UNLINKED_INSTALLATION_AGE_MS);
  const [result] = await db()
    .select({count: sql<number>`count(*)`})
    .from(githubUnlinkedInstallations)
    .leftJoin(
      githubInstallations,
      eq(githubUnlinkedInstallations.installationId, githubInstallations.installationId),
    )
    .where(
      and(
        lt(githubUnlinkedInstallations.firstSeenAt, cutoff),
        isNull(githubInstallations.installationId),
      ),
    );

  return Number(result?.count ?? 0);
}

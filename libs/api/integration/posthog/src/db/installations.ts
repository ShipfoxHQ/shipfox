import type {PosthogRegion} from '@shipfox/api-integration-posthog-dto';
import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {posthogInstallations, toPosthogInstallation} from './schema/installations.js';

export interface PosthogInstallation {
  connectionId: string;
  region: PosthogRegion;
  projectId: string;
  projectName: string;
  organizationId: string;
  keyHint: string;
  credentialVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePosthogInstallationParams {
  connectionId: string;
  region: PosthogRegion;
  projectId: string;
  projectName: string;
  organizationId: string;
  keyHint: string;
}

type PosthogDb = ReturnType<typeof db>;
type PosthogTx = Parameters<Parameters<PosthogDb['transaction']>[0]>[0];
export type PosthogDatabaseExecutor = PosthogDb | PosthogTx;

export async function createPosthogInstallation(
  params: CreatePosthogInstallationParams,
  options: {tx?: unknown} = {},
): Promise<PosthogInstallation> {
  const executor = (options.tx ?? db()) as PosthogDatabaseExecutor;
  const [row] = await executor
    .insert(posthogInstallations)
    .values({
      connectionId: params.connectionId,
      region: params.region,
      projectId: params.projectId,
      projectName: params.projectName,
      organizationId: params.organizationId,
      keyHint: params.keyHint.slice(-4),
      credentialVersion: 1,
    })
    .returning();
  if (!row) throw new Error('PostHog installation insert returned no rows');
  return toPosthogInstallation(row);
}

export async function getPosthogInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<PosthogInstallation | undefined> {
  const executor = (options.tx ?? db()) as PosthogDatabaseExecutor;
  const [row] = await executor
    .select()
    .from(posthogInstallations)
    .where(eq(posthogInstallations.connectionId, connectionId))
    .limit(1);
  return row ? toPosthogInstallation(row) : undefined;
}

export async function deletePosthogInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<boolean> {
  const executor = (options.tx ?? db()) as PosthogDatabaseExecutor;
  const result = await executor
    .delete(posthogInstallations)
    .where(eq(posthogInstallations.connectionId, connectionId));
  return (result.rowCount ?? 0) > 0;
}

export type PosthogVersionGuardResult<T> =
  | {matched: true; value: T}
  | {matched: false; reason: 'not-found' | 'version-mismatch'};

/**
 * Locks the installation and runs the callback in the same transaction when
 * the credential version still matches. The callback can update the core
 * connection through the supplied transaction without releasing the lock.
 */
export async function withPosthogCredentialVersion<T>(params: {
  connectionId: string;
  credentialVersion: number;
  callback: (input: {tx: PosthogTx; installation: PosthogInstallation}) => Promise<T>;
}): Promise<PosthogVersionGuardResult<T>> {
  return await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(posthogInstallations)
      .where(eq(posthogInstallations.connectionId, params.connectionId))
      .limit(1)
      .for('update');
    if (!row) return {matched: false, reason: 'not-found'};
    const installation = toPosthogInstallation(row);
    if (installation.credentialVersion !== params.credentialVersion) {
      return {matched: false, reason: 'version-mismatch'};
    }
    return {
      matched: true,
      value: await params.callback({tx, installation}),
    };
  });
}

export const withPosthogInstallationVersionGuard = withPosthogCredentialVersion;

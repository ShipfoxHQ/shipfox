import {Buffer} from 'node:buffer';
import type {EncodedActionBundle} from '@shipfox/workflow-document';
import {and, eq} from 'drizzle-orm';
import type {ActionSnapshot, ActionSnapshotSource} from '#core/entities/action-snapshot.js';
import {db} from './db.js';
import {definitionActionSnapshots, toActionSnapshot} from './schema/action-snapshots.js';

export interface UpsertActionSnapshotParams {
  workspaceId: string;
  projectId: string;
  manifest: Record<string, unknown>;
  bundle: EncodedActionBundle;
  source: ActionSnapshotSource;
}

/**
 * Stores a snapshot once per workspace and digest. The digest covers the whole bundle, so a
 * repeated store keeps the first row, including where it was first seen.
 */
export async function upsertActionSnapshot(params: UpsertActionSnapshotParams): Promise<void> {
  await db()
    .insert(definitionActionSnapshots)
    .values({
      workspaceId: params.workspaceId,
      digest: params.bundle.digest,
      projectId: params.projectId,
      manifest: params.manifest,
      bundle: Buffer.from(params.bundle.gzip),
      fileCount: params.bundle.fileCount,
      bytes: params.bundle.bytes,
      source: params.source,
    })
    .onConflictDoNothing({
      target: [definitionActionSnapshots.workspaceId, definitionActionSnapshots.digest],
    });
}

export async function getActionSnapshot(params: {
  workspaceId: string;
  digest: string;
}): Promise<ActionSnapshot | undefined> {
  const [row] = await db()
    .select()
    .from(definitionActionSnapshots)
    .where(
      and(
        eq(definitionActionSnapshots.workspaceId, params.workspaceId),
        eq(definitionActionSnapshots.digest, params.digest),
      ),
    )
    .limit(1);
  return row ? toActionSnapshot(row) : undefined;
}

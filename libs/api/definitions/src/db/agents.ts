import {and, asc, eq, ne, notInArray, or, type SQL, sql} from 'drizzle-orm';
import type {
  ProjectAgent,
  ProjectAgentConfig,
  ProjectAgentError,
} from '#core/entities/project-agent.js';
import {db} from './db.js';
import {definitionAgents, toProjectAgent} from './schema/agents.js';

export type ProjectAgentFile =
  | {
      key: string;
      configPath: string;
      contentHash: string;
      valid: true;
      config: ProjectAgentConfig;
    }
  | {key: string; configPath: string; valid: false; errors: ProjectAgentError[]};

export interface ApplyProjectAgentsParams {
  projectId: string;
  /** One entry per key in the agent folder, valid or not. Rows for any other key are deleted. */
  files: readonly ProjectAgentFile[];
}

export interface ApplyProjectAgentsResult {
  appliedCount: number;
  deletedCount: number;
}

/**
 * Makes the stored agents match the agent folder. A valid file replaces its
 * row. An invalid file keeps the last valid config and records the errors, and
 * one that was never valid creates no row. A key with no file loses its row.
 */
export async function applyProjectAgents(
  params: ApplyProjectAgentsParams,
): Promise<ApplyProjectAgentsResult> {
  return await db().transaction(async (tx) => {
    let appliedCount = 0;
    for (const file of params.files) {
      if (file.valid) {
        const rows = await tx
          .insert(definitionAgents)
          .values({
            projectId: params.projectId,
            key: file.key,
            configPath: file.configPath,
            config: file.config,
            contentHash: file.contentHash,
            errors: [],
          })
          .onConflictDoUpdate({
            target: [definitionAgents.projectId, definitionAgents.key],
            set: {
              configPath: file.configPath,
              config: file.config,
              contentHash: file.contentHash,
              errors: [],
              updatedAt: sql`now()`,
            },
            setWhere: changedSince(file),
          })
          .returning({id: definitionAgents.id});
        appliedCount += rows.length;
        continue;
      }

      const rows = await tx
        .update(definitionAgents)
        .set({configPath: file.configPath, errors: file.errors, updatedAt: sql`now()`})
        .where(
          and(eq(definitionAgents.projectId, params.projectId), eq(definitionAgents.key, file.key)),
        )
        .returning({id: definitionAgents.id});
      appliedCount += rows.length;
    }

    const keys = params.files.map((file) => file.key);
    const deleted = await tx
      .delete(definitionAgents)
      .where(
        keys.length === 0
          ? eq(definitionAgents.projectId, params.projectId)
          : and(
              eq(definitionAgents.projectId, params.projectId),
              notInArray(definitionAgents.key, keys),
            ),
      )
      .returning({id: definitionAgents.id});

    return {appliedCount, deletedCount: deleted.length};
  });
}

/** A row that already holds this file's content, path, and no errors needs no write. */
function changedSince(file: Extract<ProjectAgentFile, {valid: true}>): SQL {
  return or(
    ne(definitionAgents.contentHash, file.contentHash),
    ne(definitionAgents.configPath, file.configPath),
    ne(definitionAgents.errors, []),
  ) as SQL;
}

export async function listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  const rows = await db()
    .select()
    .from(definitionAgents)
    .where(eq(definitionAgents.projectId, projectId))
    .orderBy(asc(definitionAgents.key));
  return rows.map(toProjectAgent);
}

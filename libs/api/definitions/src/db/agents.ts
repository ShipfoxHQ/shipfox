import type {AgentDocument} from '@shipfox/workflow-document';
import {and, asc, eq, notInArray, sql} from 'drizzle-orm';
import type {ProjectAgent, ProjectAgentError} from '#core/entities/project-agent.js';
import {db} from './db.js';
import {definitionAgents, toProjectAgent} from './schema/agents.js';

export interface ValidAgentUpsert {
  key: string;
  configPath: string;
  name: string | null;
  description: string | null;
  instructions: string | null;
  document: AgentDocument;
  contentHash: string;
}

export interface InvalidAgentUpsert {
  key: string;
  configPath: string;
  error: ProjectAgentError;
}

export interface ApplyVcsAgentsBatchParams {
  projectId: string;
  /** The agents whose files parsed. Each one replaces its row and clears its error. */
  valid: readonly ValidAgentUpsert[];
  /** The agents whose files failed. A row that exists keeps its last valid version and records the error. */
  invalid: readonly InvalidAgentUpsert[];
}

export interface ApplyVcsAgentsBatchResult {
  appliedCount: number;
  deletedCount: number;
}

/**
 * Makes the project's agent rows match the files at the sync commit. A key
 * seen in neither list is deleted, so a renamed file starts a new agent and
 * ends the old one.
 */
export async function applyVcsAgentsBatch(
  params: ApplyVcsAgentsBatchParams,
): Promise<ApplyVcsAgentsBatchResult> {
  return await db().transaction(async (tx) => {
    for (const agent of params.valid) {
      await tx
        .insert(definitionAgents)
        .values({
          projectId: params.projectId,
          key: agent.key,
          configPath: agent.configPath,
          name: agent.name,
          description: agent.description,
          instructions: agent.instructions,
          document: agent.document,
          contentHash: agent.contentHash,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: [definitionAgents.projectId, definitionAgents.key],
          set: {
            configPath: agent.configPath,
            name: agent.name,
            description: agent.description,
            instructions: agent.instructions,
            document: agent.document,
            contentHash: agent.contentHash,
            lastError: null,
            fetchedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
    }

    for (const agent of params.invalid) {
      await tx
        .update(definitionAgents)
        .set({configPath: agent.configPath, lastError: agent.error, updatedAt: sql`now()`})
        .where(
          and(
            eq(definitionAgents.projectId, params.projectId),
            eq(definitionAgents.key, agent.key),
          ),
        );
    }

    const keepKeys = [...params.valid, ...params.invalid].map((agent) => agent.key);
    const baseWhere = eq(definitionAgents.projectId, params.projectId);
    const deleted = await tx
      .delete(definitionAgents)
      .where(
        keepKeys.length > 0
          ? and(baseWhere, notInArray(definitionAgents.key, keepKeys))
          : baseWhere,
      )
      .returning({id: definitionAgents.id});

    return {appliedCount: params.valid.length, deletedCount: deleted.length};
  });
}

export async function listProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  const rows = await db()
    .select()
    .from(definitionAgents)
    .where(eq(definitionAgents.projectId, projectId))
    .orderBy(asc(definitionAgents.key));
  return rows.map(toProjectAgent);
}

import type {
  AgentInterModuleClient,
  AgentWorkspaceModel,
} from '@shipfox/api-agent-dto/inter-module';

export type AgentAccessWorkspaceModel = AgentWorkspaceModel;
export interface AgentAccessWorkspaceModels {
  readonly models: readonly AgentAccessWorkspaceModel[];
  readonly default_model: AgentAccessWorkspaceModel | null;
  readonly attribution: string | null;
}

/**
 * Reads the models available to a workspace and its resolved default model.
 * A provider that cannot be resolved is represented as an empty default rather
 * than making a workspace with no usable provider fail the read.
 */
export async function getWorkspaceModels(
  agent: AgentInterModuleClient,
  workspaceId: string,
): Promise<AgentAccessWorkspaceModels> {
  return await agent.getWorkspaceModels({workspaceId});
}

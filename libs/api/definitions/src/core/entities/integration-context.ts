import type {
  AgentToolSelectionCatalog,
  IntegrationCapability,
  IntegrationProviderKind,
} from '@shipfox/api-integration-core-dto';

export type AgentToolSelectionCatalogs = ReadonlyMap<
  IntegrationProviderKind,
  AgentToolSelectionCatalog
>;

export interface WorkspaceConnectionSnapshotEntry {
  readonly id: string;
  readonly provider: IntegrationProviderKind;
  readonly capabilities: readonly IntegrationCapability[];
}

export type WorkspaceConnectionSnapshot = ReadonlyMap<string, WorkspaceConnectionSnapshotEntry>;

export interface IntegrationValidationContext {
  readonly agentToolSelectionCatalogs: AgentToolSelectionCatalogs;
  readonly workspaceConnectionSnapshot: WorkspaceConnectionSnapshot;
  readonly defaultConnectionSlug?: string | undefined;
}

export type LoadWorkspaceConnectionSnapshot = (
  workspaceId: string,
) => Promise<WorkspaceConnectionSnapshot>;

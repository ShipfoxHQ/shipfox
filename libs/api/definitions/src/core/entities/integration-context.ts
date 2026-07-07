import type {
  AgentToolSelectionCatalog,
  IntegrationCapability,
  IntegrationProviderKind,
} from '@shipfox/api-integration-core-dto';

export interface IntegrationValidationContext {
  readonly agentToolSelectionCatalogs: ReadonlyMap<
    IntegrationProviderKind,
    AgentToolSelectionCatalog
  >;
  readonly workspaceConnectionSnapshot: ReadonlyMap<
    string,
    {
      readonly id: string;
      readonly provider: IntegrationProviderKind;
      readonly capabilities: readonly IntegrationCapability[];
    }
  >;
  readonly defaultConnectionSlug?: string | undefined;
}

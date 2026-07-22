type IntegrationProviderKind = string;
type IntegrationCapability = 'source_control' | 'agent_tools';

interface AgentToolSelectionCatalog {
  readonly selectors: readonly AgentToolSelector[];
}

interface AgentToolSelector {
  readonly token: string;
  readonly kind: 'family' | 'family_wildcard' | 'method' | 'standalone';
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
}

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

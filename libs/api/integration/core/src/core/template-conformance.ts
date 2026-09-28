import {parse as parseYaml} from 'yaml';
import type {WorkspaceBuiltinConnection} from '#core/agent-tool-selection.js';
import {buildAgentToolSelectionCatalogs} from '#core/agent-tool-selection.js';
import {buildProviderEventCatalogs} from '#core/event-catalogs.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';

export interface IntegrationProviderCatalog {
  readonly events: ReadonlySet<string>;
  readonly tools: ReadonlySet<string>;
}

export interface IntegrationCatalog {
  readonly providers: ReadonlyMap<string, IntegrationProviderCatalog>;
  /** Built-in connection slugs, such as `shipfox`, and their providers. */
  readonly builtinConnections: ReadonlyMap<string, string>;
}

interface CatalogReference {
  kind: 'event' | 'tool';
  connection: string | undefined;
  name: string;
}

const bindMarkerPattern = /:\s*([A-Za-z0-9_-]+)\s+#\s*bind:([a-z0-9_-]+)\s*$/;

/** Builds the catalog of the providers this instance registers. */
export async function buildIntegrationCatalog(params: {
  registry: IntegrationProviderRegistry;
  builtinConnections?: readonly WorkspaceBuiltinConnection[] | undefined;
}): Promise<IntegrationCatalog> {
  const selectionCatalogs = await buildAgentToolSelectionCatalogs(params.registry);
  const eventCatalogs = new Map(
    buildProviderEventCatalogs(params.registry).map(({provider, events}) => [provider, events]),
  );
  const providers = new Map(
    params.registry.list().map(({provider}) => [
      provider,
      {
        events: new Set(eventCatalogs.get(provider) ?? []),
        tools: new Set(
          selectionCatalogs.get(provider)?.selectors.map((selector) => selector.token) ?? [],
        ),
      },
    ]),
  );
  return {
    providers,
    builtinConnections: new Map(
      (params.builtinConnections ?? []).map(({slug, provider}) => [slug, provider]),
    ),
  };
}

/**
 * Checks the tool and event references of a composed template workflow against the catalog.
 * A reference belongs to the provider bound to the role of its connection's `# bind:<role>`
 * marker, or to a built-in connection. Returns one message per problem.
 */
export function templateCatalogIssues(params: {
  workflow: string;
  /** Template role to provider, such as `{tracker: 'linear'}`. */
  bindings: Readonly<Record<string, string>>;
  catalog: IntegrationCatalog;
}): string[] {
  let document: unknown;
  try {
    document = parseYaml(params.workflow);
  } catch (error) {
    return [
      `workflow is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  const issues: string[] = [];
  const providerByConnection = new Map(params.catalog.builtinConnections);
  for (const [connection, role] of boundConnectionRoles(params.workflow)) {
    const provider = params.bindings[role];
    if (provider === undefined) {
      issues.push(`connection ${connection} is bound to role ${role}, which has no provider`);
    } else {
      providerByConnection.set(connection, provider);
    }
  }
  for (const reference of collectCatalogReferences(document)) {
    const issue = referenceIssue(reference, providerByConnection, params.catalog);
    if (issue !== undefined) issues.push(issue);
  }
  return [...new Set(issues)];
}

function referenceIssue(
  {kind, connection, name}: CatalogReference,
  providerByConnection: ReadonlyMap<string, string>,
  catalog: IntegrationCatalog,
): string | undefined {
  const provider = connection === undefined ? undefined : providerByConnection.get(connection);
  if (connection === undefined || provider === undefined) {
    const target = connection === undefined ? 'no connection' : `connection ${connection}`;
    return `${kind} ${name} uses ${target}, which is not bound to a role`;
  }

  const providerCatalog = catalog.providers.get(provider);
  if (providerCatalog === undefined) {
    return `connection ${connection} uses provider ${provider}, which is not available`;
  }
  const known = kind === 'event' ? providerCatalog.events : providerCatalog.tools;
  return known.has(name) ? undefined : `${connection} (${provider}): unknown ${kind} ${name}`;
}

function boundConnectionRoles(workflow: string): Map<string, string> {
  const roles = new Map<string, string>();
  for (const line of workflow.split('\n')) {
    const match = bindMarkerPattern.exec(line);
    const connection = match?.[1];
    const role = match?.[2];
    if (connection !== undefined && role !== undefined) roles.set(connection, role);
  }
  return roles;
}

function collectCatalogReferences(value: unknown): CatalogReference[] {
  const references: CatalogReference[] = [];
  visitCatalogReferences(value, references);
  return references;
}

function visitCatalogReferences(value: unknown, references: CatalogReference[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visitCatalogReferences(item, references);
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.source === 'string' && typeof value.event === 'string') {
    references.push({kind: 'event', connection: value.source, name: value.event});
  }
  if (typeof value.tool === 'string') {
    references.push({
      kind: 'tool',
      connection: stringOrUndefined(value.connection),
      name: value.tool,
    });
  }
  if (Array.isArray(value.integrations)) addIntegrationReferences(value.integrations, references);

  for (const nested of Object.values(value)) visitCatalogReferences(nested, references);
}

function addIntegrationReferences(integrations: unknown[], references: CatalogReference[]): void {
  for (const integration of integrations) {
    if (!isRecord(integration) || !Array.isArray(integration.include)) continue;
    const connection = stringOrUndefined(integration.connection);
    for (const tool of integration.include) {
      if (typeof tool === 'string') references.push({kind: 'tool', connection, name: tool});
    }
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

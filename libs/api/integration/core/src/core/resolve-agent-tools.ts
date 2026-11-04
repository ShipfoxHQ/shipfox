import {
  type AgentToolCatalogEntry,
  type AgentToolResultKind,
  agentToolResultKind,
  type IntegrationProviderKind,
} from '@shipfox/api-integration-spi';
import type {AgentToolCatalogs, WorkspaceConnectionSnapshot} from './agent-tool-selection.js';

type AgentToolCatalogMethod = NonNullable<AgentToolCatalogEntry['methods']>[number];

export type AgentToolsFailureReason =
  | 'connection-missing'
  | 'connection-provider-mismatch'
  | 'connection-not-allowed'
  | 'source-connection-missing'
  | 'tool-unknown'
  | 'no-tools-selected'
  | 'write-not-allowed';

/** A selection that cannot be granted. `integrationIndex` names the entry that failed. */
export class AgentToolsSelectionError extends Error {
  constructor(
    message: string,
    readonly details: {
      /** Absent when the failure has no reason a caller acts on. */
      readonly reason?: AgentToolsFailureReason;
      readonly connection?: string | undefined;
      readonly tool?: string | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'AgentToolsSelectionError';
  }
}

export interface AgentToolsSelection {
  readonly connection?: string | undefined;
  readonly provider?: string | undefined;
  readonly include: readonly string[];
  readonly exclude?: readonly string[] | undefined;
  readonly allowWrite: boolean;
}

export interface ResolvedAgentToolMethod {
  readonly id: string;
  readonly token: string;
  readonly description: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
  readonly requiredScope: unknown[];
}

export interface ResolvedAgentTool {
  readonly id: string;
  readonly description: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
  readonly requiredScope: unknown[];
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly result: AgentToolResultKind;
  readonly methods?: ResolvedAgentToolMethod[];
}

export interface ResolvedAgentToolsGrant {
  readonly connectionId: string;
  readonly connectionSlug: string;
  readonly provider: IntegrationProviderKind;
  readonly requiredScope: unknown[];
  readonly tools: ResolvedAgentTool[];
}

export interface ResolveAgentToolsContext {
  readonly catalogs: AgentToolCatalogs;
  readonly workspaceConnections: WorkspaceConnectionSnapshot;
  /** Slugs of the connections outside the project's access, which no selection may name. */
  readonly blockedConnections?: ReadonlySet<string> | undefined;
  /** Null when the project has no connection to default to. */
  readonly defaultConnection: {
    readonly id: string;
    readonly slug: string;
    readonly provider: IntegrationProviderKind;
  } | null;
}

interface SelectedToolState {
  readonly entry: AgentToolCatalogEntry;
  readonly methods: Map<string, AgentToolCatalogMethod>;
  selectedStandalone: boolean;
}

/**
 * Expands one selection into the tools its connection grants. A selection that grants nothing,
 * names an unknown tool, or grants a write tool without `allowWrite` throws
 * `AgentToolsSelectionError`.
 */
export function resolveAgentToolsGrant(params: {
  readonly selection: AgentToolsSelection;
  readonly context: ResolveAgentToolsContext;
}): ResolvedAgentToolsGrant {
  const {selection, context} = params;
  const connection = resolveConnection({connectionSlug: selection.connection, context});
  if (selection.provider !== undefined && connection.provider !== selection.provider) {
    throw new AgentToolsSelectionError(
      `Integration connection ${connection.slug} is a ${connection.provider} connection, but a ${selection.provider} connection is required`,
      {reason: 'connection-provider-mismatch', connection: connection.slug},
    );
  }
  const catalog = context.catalogs.get(connection.provider);
  if (catalog === undefined) {
    throw new AgentToolsSelectionError(
      `Integration provider ${connection.provider} has no agent tool catalog`,
    );
  }

  const tools = selectToolStates({
    catalog,
    connection: connection.slug,
    include: selection.include,
    exclude: selection.exclude ?? [],
  }).map(resolvedTool);
  if (!selection.allowWrite) {
    const write = tools.find((tool) => tool.sensitivity === 'write');
    if (write !== undefined) {
      throw new AgentToolsSelectionError(
        `Integration selection includes write-capable tools but allow_write is not true: ${write.id}`,
        {reason: 'write-not-allowed', connection: connection.slug, tool: write.id},
      );
    }
  }

  return {
    connectionId: connection.id,
    connectionSlug: connection.slug,
    provider: connection.provider,
    requiredScope: mergeRequiredScopes(tools.map((tool) => tool.requiredScope)),
    tools,
  };
}

function resolveConnection(params: {
  readonly connectionSlug: string | undefined;
  readonly context: ResolveAgentToolsContext;
}): {id: string; slug: string; provider: IntegrationProviderKind} {
  const {connectionSlug, context} = params;
  if (connectionSlug === undefined) {
    if (context.defaultConnection === null) {
      throw new AgentToolsSelectionError(
        'The workspace has no single source-control connection to use by default. Name a `connection`.',
        {reason: 'source-connection-missing'},
      );
    }
    return context.defaultConnection;
  }

  const connection = context.workspaceConnections.get(connectionSlug);
  if (connection === undefined) {
    throw new AgentToolsSelectionError(`Integration connection ${connectionSlug} was not found`, {
      reason: 'connection-missing',
      connection: connectionSlug,
    });
  }
  if (context.blockedConnections?.has(connectionSlug)) {
    throw new AgentToolsSelectionError(
      `Integration connection ${connectionSlug} is not in this project's access`,
      {reason: 'connection-not-allowed', connection: connectionSlug},
    );
  }
  return {id: connection.id, slug: connectionSlug, provider: connection.provider};
}

function selectToolStates(params: {
  readonly catalog: readonly AgentToolCatalogEntry[];
  readonly connection: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}): SelectedToolState[] {
  const selected = new Map<string, SelectedToolState>();

  for (const token of params.include) {
    applySelection({
      catalog: params.catalog,
      connection: params.connection,
      selected,
      token,
      mode: 'include',
    });
  }
  for (const token of params.exclude) {
    applySelection({
      catalog: params.catalog,
      connection: params.connection,
      selected,
      token,
      mode: 'exclude',
    });
  }

  const states = params.catalog.flatMap((entry) => selected.get(entry.id) ?? []);
  if (states.length === 0) {
    throw new AgentToolsSelectionError('Agent integration selection resolved to no tools', {
      reason: 'no-tools-selected',
      connection: params.connection,
    });
  }
  return states;
}

function applySelection(params: {
  readonly catalog: readonly AgentToolCatalogEntry[];
  readonly connection: string;
  readonly selected: Map<string, SelectedToolState>;
  readonly token: string;
  readonly mode: 'include' | 'exclude';
}): void {
  if (params.token === '*') {
    for (const entry of params.catalog) applyEntrySelection(params, entry);
    return;
  }

  const match = findCatalogSelection(params.catalog, params.token);
  if (match === undefined) {
    throw new AgentToolsSelectionError(`Unknown integration tool: ${params.token}`, {
      reason: 'tool-unknown',
      connection: params.connection,
      tool: params.token,
    });
  }
  applyEntrySelection(params, match.entry, match.method);
}

function applyEntrySelection(
  params: {
    readonly selected: Map<string, SelectedToolState>;
    readonly token: string;
    readonly mode: 'include' | 'exclude';
  },
  entry: AgentToolCatalogEntry,
  method?: AgentToolCatalogMethod | undefined,
): void {
  if (params.mode === 'exclude') {
    excludeEntrySelection(params.selected, entry, method);
    return;
  }

  const state =
    params.selected.get(entry.id) ??
    ({entry, methods: new Map(), selectedStandalone: false} satisfies SelectedToolState);
  if (entry.methods === undefined) {
    state.selectedStandalone = true;
  } else if (method === undefined) {
    for (const candidate of entry.methods) state.methods.set(candidate.id, candidate);
  } else {
    state.methods.set(method.id, method);
  }
  params.selected.set(entry.id, state);
}

function excludeEntrySelection(
  selected: Map<string, SelectedToolState>,
  entry: AgentToolCatalogEntry,
  method?: AgentToolCatalogMethod | undefined,
): void {
  if (method === undefined) {
    selected.delete(entry.id);
    return;
  }

  const state = selected.get(entry.id);
  if (state === undefined) return;
  state.methods.delete(method.id);
  if (!state.selectedStandalone && state.methods.size === 0) selected.delete(entry.id);
}

function findCatalogSelection(
  catalog: readonly AgentToolCatalogEntry[],
  token: string,
):
  | {readonly entry: AgentToolCatalogEntry; readonly method?: AgentToolCatalogMethod | undefined}
  | undefined {
  const entry = catalog.find((candidate) => candidate.id === token);
  if (entry !== undefined) return {entry};

  const wildcardSuffix = '.*';
  if (token.endsWith(wildcardSuffix)) {
    const family = token.slice(0, -wildcardSuffix.length);
    const familyEntry = catalog.find((candidate) => candidate.id === family);
    return familyEntry === undefined ? undefined : {entry: familyEntry};
  }

  const dotIndex = token.indexOf('.');
  if (dotIndex < 1) return undefined;
  const family = token.slice(0, dotIndex);
  const methodId = token.slice(dotIndex + 1);
  const familyEntry = catalog.find((candidate) => candidate.id === family);
  const method = familyEntry?.methods?.find((candidate) => candidate.id === methodId);
  if (familyEntry === undefined || method === undefined) return undefined;
  return {entry: familyEntry, method};
}

function resolvedTool(state: SelectedToolState): ResolvedAgentTool {
  const {entry} = state;
  const common = {
    id: entry.id,
    description: entry.description,
    inputSchema: entry.inputSchema as Record<string, unknown>,
    ...(entry.outputSchema === undefined
      ? {}
      : {outputSchema: entry.outputSchema as Record<string, unknown>}),
    result: agentToolResultKind(entry),
  };
  if (entry.methods === undefined) {
    return {
      ...common,
      sensitivity: entry.sensitivity,
      sensitive: entry.sensitive,
      requiredScope: normalizeRequiredScope(entry.requiredScope),
    };
  }

  const methods = entry.methods
    .filter((method) => state.methods.has(method.id))
    .map((method) => ({
      id: method.id,
      token: `${entry.id}.${method.id}`,
      description: method.description,
      sensitivity: method.sensitivity,
      sensitive: method.sensitive,
      requiredScope: normalizeRequiredScope(method.requiredScope),
    }));

  return {
    ...common,
    sensitivity: methods.some((method) => method.sensitivity === 'write') ? 'write' : 'read',
    sensitive: methods.some((method) => method.sensitive),
    requiredScope: mergeRequiredScopes(methods.map((method) => method.requiredScope)),
    methods,
  };
}

function mergeRequiredScopes(scopes: readonly unknown[]): unknown[] {
  const items = scopes.flatMap(normalizeRequiredScope);
  if (items.every(isPermissionScope)) {
    const byPermission = new Map<string, 'read' | 'write'>();
    for (const item of items) {
      const existing = byPermission.get(item.permission);
      if (existing === 'write') continue;
      byPermission.set(item.permission, item.access);
    }
    return [...byPermission.entries()].map(([permission, access]) => ({permission, access}));
  }

  const deduped = new Map<string, unknown>();
  for (const item of items) deduped.set(JSON.stringify(item), item);
  return [...deduped.values()];
}

function normalizeRequiredScope(scope: unknown): unknown[] {
  return Array.isArray(scope) ? [...scope] : [scope];
}

function isPermissionScope(
  value: unknown,
): value is {permission: string; access: 'read' | 'write'} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {permission?: unknown; access?: unknown};
  return (
    typeof candidate.permission === 'string' &&
    (candidate.access === 'read' || candidate.access === 'write')
  );
}

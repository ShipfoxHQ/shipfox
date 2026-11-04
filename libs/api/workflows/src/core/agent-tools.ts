import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import {flattenJobSteps, type WorkflowModel} from '@shipfox/api-definitions-dto';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {AgentIntegrationMaterializationReason} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {AgentIntegrationMaterializationError} from './errors.js';
import {isManagedProject} from './managed-source.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelAgentStep = Extract<WorkflowModelJob['steps'][number], {kind: 'agent'}>;
type WorkflowModelActionStep = Extract<WorkflowModelJob['steps'][number], {kind: 'action'}>;
type WorkflowModelActionIntegrations = WorkflowModelActionStep['action']['integrations'];
type WorkflowModelStepIntegration = NonNullable<WorkflowModelAgentStep['integrations']>[number];
type IntegrationsAgentToolsContext = Awaited<
  ReturnType<IntegrationsModuleClient['getAgentToolsContext']>
>;
export type AgentToolCatalogEntry =
  IntegrationsAgentToolsContext['catalogs'][number]['tools'][number];
type AgentToolCatalogMethod = NonNullable<AgentToolCatalogEntry['methods']>[number];
type ResolvedAgentToolsGrant = Awaited<
  ReturnType<IntegrationsModuleClient['resolveAgentTools']>
>['integrations'][number];
type IntegrationProviderKind = IntegrationsAgentToolsContext['catalogs'][number]['provider'];
type AgentToolCatalogs = ReadonlyMap<IntegrationProviderKind, readonly AgentToolCatalogEntry[]>;
type WorkspaceConnectionSnapshot = ReadonlyMap<
  string,
  {
    id: string;
    provider: IntegrationProviderKind;
    capabilities: readonly ('source_control' | 'agent_tools' | 'interaction')[];
  }
>;

export interface AgentToolMaterializationContext {
  readonly catalogs: AgentToolCatalogs;
  readonly workspaceConnectionSnapshot: WorkspaceConnectionSnapshot;
  /** Null on a managed project whose workspace has no single source-control connection. */
  readonly defaultConnection: {
    readonly id: string;
    readonly slug: string;
    readonly provider: IntegrationProviderKind;
  } | null;
  /**
   * What Integrations granted each agent step and action step, or why it could not. A failure
   * waits here until the step materializes, so it surfaces where a failed selection always has.
   */
  readonly integrationOutcomes?: ReadonlyMap<string, IntegrationOutcome> | undefined;
}

export type IntegrationOutcome =
  | {readonly kind: 'granted'; readonly grants: readonly ResolvedAgentToolsGrant[]}
  | {readonly kind: 'failed'; readonly error: AgentIntegrationMaterializationError};

export interface AgentToolMaterializationSnapshot {
  readonly steps: readonly AgentToolMaterializationSnapshotStep[];
}

export interface AgentToolMaterializationSnapshotStep {
  readonly jobKey: string;
  readonly stepId: string;
  readonly integrations?: readonly MaterializedAgentIntegrationConfigDto[];
  readonly tool?: MaterializedToolStep;
  /** Action step grants, keyed by manifest alias. */
  readonly actionIntegrations?: Readonly<Record<string, MaterializedActionIntegration>>;
}

export interface MaterializedActionIntegration
  extends Omit<MaterializedAgentIntegrationConfigDto, 'tools'> {
  readonly tools: readonly MaterializedActionTool[];
}

export type MaterializedActionTool = MaterializedAgentIntegrationToolConfigDto & {
  readonly result: AgentToolCatalogEntry['result'];
};

export interface MaterializedToolStep {
  readonly connectionId: string;
  readonly connectionSlug: string;
  readonly provider: string;
  readonly id: string;
  readonly method?: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
  readonly requiredScope: readonly unknown[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

export async function loadAgentToolMaterializationContext(params: {
  readonly model: WorkflowModel | null;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly integrations?: IntegrationsModuleClient | undefined;
  readonly projects?: ProjectsModuleClient | undefined;
  readonly jobs?: readonly WorkflowModelJob[] | undefined;
}): Promise<AgentToolMaterializationContext | undefined> {
  if (!hasIntegrationToolReferences(params.model, params.jobs)) return undefined;

  if (params.projects === undefined) {
    throw new AgentIntegrationMaterializationError('Project access is not configured');
  }
  const {project} = await params.projects.getProjectById({projectId: params.projectId});
  if (project === null) {
    throw new AgentIntegrationMaterializationError(
      `Project ${params.projectId} was not found while materializing agent integrations`,
    );
  }

  if (params.integrations === undefined) {
    throw new AgentIntegrationMaterializationError('Agent tool materialization is not configured');
  }
  const context = await params.integrations.getAgentToolsContext({
    workspaceId: params.workspaceId,
    defaultConnectionId: project.sourceConnectionId,
  });
  const workspaceConnectionSnapshot = new Map(
    context.workspaceConnections.map(({slug, ...connection}) => [slug, connection]),
  );
  const defaultConnection = context.defaultConnection;
  // A managed project has no source connection of its own, so a step that names a connection
  // still works without a default.
  if (defaultConnection === null && !isManagedProject(project)) {
    throw new AgentIntegrationMaterializationError(
      `Source connection ${project.sourceConnectionId} was not found while materializing agent integrations`,
      {reason: 'source-connection-missing', connection: project.sourceConnectionId},
    );
  }

  const base = {
    catalogs: new Map(context.catalogs.map(({provider, tools}) => [provider, tools])),
    workspaceConnectionSnapshot,
    defaultConnection:
      defaultConnection === null
        ? null
        : {
            id: defaultConnection.id,
            slug: defaultConnection.slug,
            provider: defaultConnection.provider,
          },
  };
  const integrationOutcomes = await resolveIntegrationOutcomes({
    model: params.model,
    jobs: params.jobs,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    integrations: params.integrations,
    workspaceConnectionSnapshot,
  });
  return {...base, integrationOutcomes};
}

const KEY_SEPARATOR = '\u0000';

function agentStepKey(params: {readonly jobKey: string; readonly stepId: string}): string {
  return [params.jobKey, params.stepId].join(KEY_SEPARATOR);
}

/**
 * Asks Integrations for the tools every agent step and action step selects, one call per step.
 * Integrations is the one place selectors are interpreted. A refused selection is kept as the
 * step's outcome, so it fails the step it belongs to and no other.
 */
async function resolveIntegrationOutcomes(params: {
  readonly model: WorkflowModel | null;
  readonly jobs: readonly WorkflowModelJob[] | undefined;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly integrations: IntegrationsModuleClient;
  readonly workspaceConnectionSnapshot: WorkspaceConnectionSnapshot;
}): Promise<Map<string, IntegrationOutcome>> {
  const outcomes = new Map<string, IntegrationOutcome>();
  if (params.model === null) return outcomes;

  const requests = (params.jobs ?? params.model.jobs).flatMap((job) =>
    flattenJobSteps(job).flatMap((step) =>
      stepIntegrationRequests({
        key: agentStepKey({jobKey: job.key, stepId: step.id}),
        step,
        workspaceConnectionSnapshot: params.workspaceConnectionSnapshot,
      }),
    ),
  );
  await Promise.all(
    requests.map(async (request) => {
      try {
        const {integrations} = await params.integrations.resolveAgentTools({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          integrations: request.integrations,
        });
        outcomes.set(request.key, {kind: 'granted', grants: integrations});
      } catch (error) {
        const method = integrationsInterModuleContract.methods.resolveAgentTools;
        if (!isInterModuleKnownError(method, error)) throw error;
        if (error.code === 'project-not-found') {
          throw new AgentIntegrationMaterializationError(
            `Project ${params.projectId} was not found while materializing agent integrations`,
          );
        }
        outcomes.set(request.key, {
          kind: 'failed',
          error: request.failure(error.details.integrationIndex, error.details),
        });
      }
    }),
  );
  return outcomes;
}

interface IntegrationRequest {
  readonly key: string;
  readonly integrations: Parameters<
    IntegrationsModuleClient['resolveAgentTools']
  >[0]['integrations'];
  readonly failure: (
    index: number,
    error: SelectionInvalid,
  ) => AgentIntegrationMaterializationError;
}

function stepIntegrationRequests(params: {
  readonly key: string;
  readonly step: WorkflowModelJob['steps'][number];
  readonly workspaceConnectionSnapshot: WorkspaceConnectionSnapshot;
}): IntegrationRequest[] {
  const {key, step} = params;
  if (step.kind === 'agent' && step.integrations !== undefined) {
    return [
      {
        key,
        integrations: step.integrations.map((integration) => ({
          ...(integration.connection === undefined ? {} : {connection: integration.connection}),
          include: [...integration.include],
          ...(integration.exclude === undefined ? {} : {exclude: [...integration.exclude]}),
          allowWrite: integration.allowWrite,
        })),
        failure: (_index, error) =>
          selectionFailure(error, (connection) => ({
            connectionMissing: `Integration connection ${connection} was not found while materializing agent integrations`,
          })),
      },
    ];
  }
  if (step.kind !== 'action') return [];

  const aliases = Object.entries(step.action.integrations);
  if (aliases.length === 0) return [];
  return [
    {
      key,
      integrations: aliases.map(([, integration]) => ({
        connection: integration.connection,
        provider: integration.provider,
        include: [...integration.include],
        allowWrite: integration.allowWrite,
      })),
      failure: (index, error) => {
        const [alias, integration] = aliases[index] ?? ['', undefined];
        return selectionFailure(error, (connection) => ({
          connectionMissing: `Integration connection ${connection} was not found while materializing action integration ${alias}`,
          providerMismatch: `Action integration ${alias} expects a ${integration?.provider} connection, but ${connection} is ${params.workspaceConnectionSnapshot.get(connection)?.provider}`,
        }));
      },
    },
  ];
}

interface SelectionInvalid {
  readonly reason?: AgentIntegrationMaterializationReason | 'write-not-allowed' | undefined;
  readonly message: string;
  readonly connection?: string | undefined;
  readonly tool?: string | undefined;
}

/**
 * The failure of a refused selection. Integrations words it without a step in mind, so the two
 * reasons that name the caller's own entry take the caller's wording.
 */
function selectionFailure(
  error: SelectionInvalid,
  wording: (connection: string) => {connectionMissing: string; providerMismatch?: string},
): AgentIntegrationMaterializationError {
  let message = error.message;
  if (error.connection !== undefined) {
    const custom = wording(error.connection);
    if (error.reason === 'connection-missing') message = custom.connectionMissing;
    if (error.reason === 'connection-provider-mismatch' && custom.providerMismatch !== undefined) {
      message = custom.providerMismatch;
    }
  }
  return new AgentIntegrationMaterializationError(message, {
    reason: error.reason === 'write-not-allowed' ? undefined : error.reason,
    connection: error.connection,
    tool: error.tool,
  });
}

export function materializeAgentIntegrations(params: {
  readonly jobKey: string;
  readonly stepId: string;
  readonly integrations: readonly WorkflowModelStepIntegration[] | undefined;
  readonly context: AgentToolMaterializationContext | undefined;
  readonly snapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): MaterializedAgentIntegrationConfigDto[] | undefined {
  const snapshot = findSnapshotStep(params);
  if (snapshot !== undefined && snapshot.integrations !== undefined) {
    return snapshot.integrations.map(copyMaterializedIntegration);
  }
  if (params.integrations === undefined) return undefined;
  if (params.context === undefined) {
    throw new AgentIntegrationMaterializationError(
      'Agent integrations require materialization context',
    );
  }
  const outcome = requireOutcome(params.context, {
    jobKey: params.jobKey,
    stepId: params.stepId,
    what: 'Agent integrations',
  });
  return outcome.grants.map(toMaterializedIntegration);
}

export function materializeToolStep(params: {
  readonly jobKey: string;
  readonly stepId: string;
  readonly tool: {readonly id: string; readonly method?: string};
  readonly connection?: string | undefined;
  readonly context: AgentToolMaterializationContext | undefined;
  readonly snapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): MaterializedToolStep {
  const snapshot = findSnapshotStep(params)?.tool;
  if (snapshot !== undefined) return {...snapshot, requiredScope: [...snapshot.requiredScope]};
  if (params.context === undefined) {
    throw new AgentIntegrationMaterializationError('Tool steps require materialization context');
  }
  const connection = resolveConnection({
    connectionSlug: params.connection,
    context: params.context,
    missingMessage: `Integration connection ${params.connection} was not found while materializing tool step`,
  });
  const catalog = params.context.catalogs.get(connection.provider);
  if (catalog === undefined) {
    throw new AgentIntegrationMaterializationError(
      `Integration provider ${connection.provider} has no agent tool catalog`,
    );
  }
  const entry = catalog.find((candidate) => candidate.id === params.tool.id);
  if (entry === undefined) {
    throw new AgentIntegrationMaterializationError(`Unknown integration tool: ${params.tool.id}`, {
      reason: 'tool-unknown',
      connection: connection.slug,
      tool: params.tool.id,
    });
  }
  const method = resolveToolMethod(entry, params.tool.method, connection.slug);
  return deepFreeze({
    connectionId: connection.id,
    connectionSlug: connection.slug,
    provider: connection.provider,
    id: entry.id,
    ...(method === undefined ? {} : {method: method.id}),
    sensitivity: method?.sensitivity ?? entry.sensitivity,
    sensitive: method?.sensitive ?? entry.sensitive,
    requiredScope: normalizeRequiredScope(method?.requiredScope ?? entry.requiredScope),
    inputSchema: cloneJson(entry.inputSchema),
    ...(entry.outputSchema === undefined ? {} : {outputSchema: cloneJson(entry.outputSchema)}),
  });
}

export function materializeActionIntegrations(params: {
  readonly jobKey: string;
  readonly stepId: string;
  readonly integrations: WorkflowModelActionIntegrations;
  readonly context: AgentToolMaterializationContext | undefined;
  readonly snapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): Record<string, MaterializedActionIntegration> {
  const snapshot = findSnapshotStep(params)?.actionIntegrations;
  if (snapshot !== undefined) return cloneJson(snapshot);
  const aliases = Object.entries(params.integrations);
  if (aliases.length === 0) return {};
  const {context} = params;
  if (context === undefined) {
    throw new AgentIntegrationMaterializationError(
      'Action integrations require materialization context',
    );
  }

  const outcome = requireOutcome(context, {
    jobKey: params.jobKey,
    stepId: params.stepId,
    what: 'Action integrations',
  });
  return Object.fromEntries(
    aliases.map(([alias], index) => {
      const grant = outcome.grants[index];
      if (grant === undefined) {
        throw new AgentIntegrationMaterializationError(
          `Action integration ${alias} was not resolved`,
        );
      }
      return [alias, toMaterializedActionIntegration(grant)];
    }),
  );
}

function requireOutcome(
  context: AgentToolMaterializationContext,
  params: {readonly jobKey: string; readonly stepId: string; readonly what: string},
): Extract<IntegrationOutcome, {kind: 'granted'}> {
  const outcome = context.integrationOutcomes?.get(agentStepKey(params));
  if (outcome === undefined) {
    throw new AgentIntegrationMaterializationError(
      `${params.what} require materialization context`,
    );
  }
  if (outcome.kind === 'failed') throw outcome.error;
  return outcome;
}

/** The persisted grant leaves out what a model-facing caller reads: descriptions and result kind. */
function toMaterializedIntegration(
  grant: ResolvedAgentToolsGrant,
): MaterializedAgentIntegrationConfigDto {
  return {
    connectionId: grant.connectionId,
    connectionSlug: grant.connectionSlug,
    provider: grant.provider,
    requiredScope: grant.requiredScope,
    tools: grant.tools.map(({description: _description, result: _result, ...tool}) => tool),
  };
}

function toMaterializedActionIntegration(
  grant: ResolvedAgentToolsGrant,
): MaterializedActionIntegration {
  return {
    connectionId: grant.connectionId,
    connectionSlug: grant.connectionSlug,
    provider: grant.provider,
    requiredScope: grant.requiredScope,
    tools: grant.tools.map(({description: _description, ...tool}) => tool),
  };
}

function resolveToolMethod(
  entry: AgentToolCatalogEntry,
  methodId: string | undefined,
  connectionSlug: string,
): AgentToolCatalogMethod | undefined {
  if (methodId === undefined) return undefined;

  const method = entry.methods?.find((candidate) => candidate.id === methodId);
  if (method === undefined) {
    throw new AgentIntegrationMaterializationError(
      `Unknown integration tool: ${entry.id}.${methodId}`,
      {reason: 'tool-unknown', connection: connectionSlug, tool: `${entry.id}.${methodId}`},
    );
  }
  return method;
}

/**
 * Finds the frozen grants of a materialized action step. Step rows keep their
 * position in the flattened model job, after the setup step at position 0, so
 * the model supplies the stable step id the snapshot is keyed by.
 */
export function findFrozenActionIntegrations(params: {
  readonly model: WorkflowModel;
  readonly snapshot: AgentToolMaterializationSnapshot | null;
  readonly jobKey: string;
  readonly stepPosition: number;
}): Readonly<Record<string, MaterializedActionIntegration>> | undefined {
  const job = params.model.jobs.find((candidate) => candidate.key === params.jobKey);
  const step = job === undefined ? undefined : flattenJobSteps(job)[params.stepPosition - 1];
  if (step?.kind !== 'action') return undefined;
  if (Object.keys(step.action.integrations).length === 0) return {};
  return findSnapshotStep({jobKey: params.jobKey, stepId: step.id, snapshot: params.snapshot})
    ?.actionIntegrations;
}

/**
 * Gateway tool names are namespaced by connection slug, so aliases bound to the
 * same connection share one entry, with their tools and methods unioned.
 */
export function flattenActionIntegrations(
  grants: Readonly<Record<string, MaterializedActionIntegration>>,
): MaterializedActionIntegration[] {
  const byConnection = new Map<string, MaterializedActionIntegration>();
  for (const grant of Object.values(grants)) {
    const existing = byConnection.get(grant.connectionId);
    byConnection.set(
      grant.connectionId,
      existing === undefined ? grant : mergeActionIntegrations(existing, grant),
    );
  }
  return [...byConnection.values()];
}

function mergeActionIntegrations(
  first: MaterializedActionIntegration,
  second: MaterializedActionIntegration,
): MaterializedActionIntegration {
  const toolsById = new Map(first.tools.map((tool) => [tool.id, tool]));
  for (const tool of second.tools) {
    const existing = toolsById.get(tool.id);
    toolsById.set(tool.id, existing === undefined ? tool : mergeActionTools(existing, tool));
  }
  const tools = [...toolsById.values()];
  return {
    ...first,
    requiredScope: mergeRequiredScopes(tools.map((tool) => tool.requiredScope)),
    tools,
  };
}

function mergeActionTools(
  first: MaterializedActionTool,
  second: MaterializedActionTool,
): MaterializedActionTool {
  if (first.methods === undefined || second.methods === undefined) return first;
  const known = new Set(first.methods.map((method) => method.id));
  const methods = [...first.methods, ...second.methods.filter((method) => !known.has(method.id))];
  return {
    ...first,
    sensitivity: methods.some((method) => method.sensitivity === 'write') ? 'write' : 'read',
    sensitive: methods.some((method) => method.sensitive),
    requiredScope: mergeRequiredScopes(methods.map((method) => method.requiredScope)),
    methods,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createAgentToolMaterializationSnapshot(params: {
  readonly model: WorkflowModel;
  readonly context: AgentToolMaterializationContext | undefined;
}): AgentToolMaterializationSnapshot | null {
  if (params.context === undefined) return null;

  const {context} = params;
  const steps = params.model.jobs.flatMap((job) =>
    flattenJobSteps(job).flatMap((step, stepPosition) => {
      try {
        return snapshotStep({jobKey: job.key, step, context}) ?? [];
      } catch (error) {
        if (!(error instanceof AgentIntegrationMaterializationError)) throw error;
        throw error.at({
          jobKey: job.key,
          step: {key: step.key, name: step.name, index: stepPosition + 1},
        });
      }
    }),
  );

  return steps.length === 0 ? null : {steps};
}

function snapshotStep(params: {
  readonly jobKey: string;
  readonly step: WorkflowModelJob['steps'][number];
  readonly context: AgentToolMaterializationContext;
}): AgentToolMaterializationSnapshotStep | undefined {
  const {jobKey, step, context} = params;
  const base = {jobKey, stepId: step.id};
  if (step.kind === 'tool') {
    const tool = materializeToolStep({
      ...base,
      tool: step.tool,
      connection: step.connection,
      context,
      snapshot: undefined,
    });
    return {...base, tool};
  }
  if (step.kind === 'action') {
    if (Object.keys(step.action.integrations).length === 0) return undefined;
    const actionIntegrations = materializeActionIntegrations({
      ...base,
      integrations: step.action.integrations,
      context,
    });
    return {...base, actionIntegrations};
  }
  if (step.kind !== 'agent' || step.integrations === undefined) return undefined;
  const integrations = materializeAgentIntegrations({
    ...base,
    integrations: step.integrations,
    context,
  });
  return integrations === undefined ? undefined : {...base, integrations};
}

function findSnapshotStep(params: {
  readonly jobKey: string;
  readonly stepId: string;
  readonly snapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): AgentToolMaterializationSnapshotStep | undefined {
  return params.snapshot?.steps.find(
    (step) => step.jobKey === params.jobKey && step.stepId === params.stepId,
  );
}

function copyMaterializedIntegration(
  integration: MaterializedAgentIntegrationConfigDto,
): MaterializedAgentIntegrationConfigDto {
  return {
    ...integration,
    requiredScope: [...integration.requiredScope],
    tools: integration.tools.map((tool) => ({
      ...tool,
      requiredScope: [...tool.requiredScope],
      ...(tool.methods === undefined
        ? {}
        : {
            methods: tool.methods.map((method) => ({
              ...method,
              requiredScope: [...method.requiredScope],
            })),
          }),
    })),
  };
}

function resolveConnection(params: {
  readonly connectionSlug: string | undefined;
  readonly context: AgentToolMaterializationContext;
  readonly missingMessage: string;
}): NonNullable<AgentToolMaterializationContext['defaultConnection']> {
  if (params.connectionSlug === undefined) {
    if (params.context.defaultConnection === null) {
      throw new AgentIntegrationMaterializationError(
        'The workspace has no single source-control connection to use by default. Name a `connection`.',
        {reason: 'source-connection-missing'},
      );
    }
    return params.context.defaultConnection;
  }

  const connection = params.context.workspaceConnectionSnapshot.get(params.connectionSlug);
  if (connection === undefined) {
    throw new AgentIntegrationMaterializationError(params.missingMessage, {
      reason: 'connection-missing',
      connection: params.connectionSlug,
    });
  }
  return {
    id: connection.id,
    slug: params.connectionSlug,
    provider: connection.provider,
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

/**
 * Model-level twin of `hasIntegrationToolReferences` in
 * `libs/api/definitions/src/core/has-integration-tool-references.ts`, which
 * runs the same criterion over the authored `WorkflowDocument` at sync time.
 * Keep both in sync. Action integrations are the exception: they live in the
 * action manifest, which the document twin cannot see.
 */
function hasIntegrationToolReferences(
  model: WorkflowModel | null,
  jobs: readonly WorkflowModelJob[] | undefined,
): boolean {
  if (model === null) return false;
  return (jobs ?? model.jobs).some((job) =>
    flattenJobSteps(job).some(
      (step) =>
        step.kind === 'tool' ||
        (step.kind === 'agent' && step.integrations !== undefined) ||
        (step.kind === 'action' && Object.keys(step.action.integrations).length > 0),
    ),
  );
}

import type {WorkflowDocumentStepIntegration} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModelStepIntegration} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

interface AgentToolSelector {
  readonly token: string;
  readonly kind: 'family' | 'family_wildcard' | 'method' | 'standalone';
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
}

export function normalizeAgentIntegrations(params: {
  integrations: readonly WorkflowDocumentStepIntegration[] | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): readonly WorkflowModelStepIntegration[] | undefined {
  if (params.integrations === undefined) return undefined;

  return params.integrations.map((integration, integrationIndex) => {
    const normalized = normalizeIntegration(integration);
    validateIntegration({...params, integration, normalized, integrationIndex});
    return normalized;
  });
}

/**
 * Checks the `integrations:` of an agent file against the workspace's connections and provider
 * catalogs, with the selector and `allow_write` rules of an agent step. The default connection is
 * the project's, so an entry without a `connection` needs one.
 */
export function validateAgentFileIntegrations(params: {
  integrations: readonly WorkflowDocumentStepIntegration[] | undefined;
  integrationValidationContext: IntegrationValidationContext;
  issues: WorkflowModelValidationIssue[];
}): void {
  const context = params.integrationValidationContext;
  params.integrations?.forEach((integration, integrationIndex) => {
    const path = ['integrations', integrationIndex] as const;
    const connectionSlug = integration.connection ?? context.defaultConnectionSlug;
    if (connectionSlug === undefined) {
      params.issues.push(
        issue({
          code: 'missing-connection-for-integration',
          message:
            'An agent integration requires a connection, because the project has no default source connection.',
          path,
          details: {integrationIndex},
        }),
      );
      return;
    }

    const selectorsByToken = resolveAgentToolConnection({
      connectionSlug,
      path: integration.connection === undefined ? path : [...path, 'connection'],
      details: {integrationIndex},
      issues: params.issues,
      context,
    });
    if (selectorsByToken === undefined) return;

    validateAgentToolSelection({
      include: integration.include,
      ...(integration.exclude === undefined ? {} : {exclude: integration.exclude}),
      allowWrite: integration.allow_write ?? false,
      selectorsByToken,
      selectorPath: (field, tokenIndex) =>
        tokenIndex === undefined ? [...path, field] : [...path, field, tokenIndex],
      details: {integrationIndex},
      issues: params.issues,
    });
  });
}

function normalizeIntegration(
  integration: WorkflowDocumentStepIntegration,
): WorkflowModelStepIntegration {
  return {
    ...(integration.connection === undefined ? {} : {connection: integration.connection}),
    include: dedupe(integration.include),
    ...(integration.exclude === undefined ? {} : {exclude: dedupe(integration.exclude)}),
    allowWrite: integration.allow_write ?? false,
  };
}

function validateIntegration(params: {
  integration: WorkflowDocumentStepIntegration;
  normalized: WorkflowModelStepIntegration;
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
  issues: WorkflowModelValidationIssue[];
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): void {
  const context = params.integrationValidationContext;
  if (context === undefined) return;

  const connectionSlug = params.normalized.connection ?? context.defaultConnectionSlug;
  if (connectionSlug === undefined) {
    params.issues.push(
      issue({
        code: 'missing-connection-for-integration',
        message: 'Agent step integration requires a connection or a default source connection.',
        path: integrationPath(params),
        details: {integrationIndex: params.integrationIndex},
      }),
    );
    return;
  }

  const selectorsByToken = resolveAgentToolConnection({
    connectionSlug,
    path: integrationConnectionPath(params),
    details: {integrationIndex: params.integrationIndex},
    issues: params.issues,
    context,
  });
  if (selectorsByToken === undefined) return;

  validateAgentToolSelection({
    include: params.integration.include,
    ...(params.integration.exclude === undefined ? {} : {exclude: params.integration.exclude}),
    allowWrite: params.normalized.allowWrite,
    selectorsByToken,
    selectorPath: (field, tokenIndex) =>
      tokenIndex === undefined
        ? [...integrationPath(params), field]
        : [...integrationPath(params), field, tokenIndex],
    issues: params.issues,
  });
}

/**
 * Looks up a connection that serves agent tools and returns its provider's
 * selectors, or reports why it cannot serve them.
 */
export function resolveAgentToolConnection(params: {
  connectionSlug: string;
  /** Rejects a connection of another provider. */
  expectedProvider?: string;
  path: readonly (string | number)[];
  details?: Readonly<Record<string, unknown>>;
  issues: WorkflowModelValidationIssue[];
  context: IntegrationValidationContext;
}): ReadonlyMap<string, AgentToolSelector> | undefined {
  const {connectionSlug} = params;
  const connection = params.context.workspaceConnectionSnapshot.get(connectionSlug);
  if (connection === undefined) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-found',
        message: `Integration connection "${connectionSlug}" was not found in the workspace.`,
        path: params.path,
        details: {connection: connectionSlug, ...params.details},
      }),
    );
    return undefined;
  }

  if (params.expectedProvider !== undefined && connection.provider !== params.expectedProvider) {
    params.issues.push(
      issue({
        code: 'integration-connection-provider-mismatch',
        message: `Integration connection "${connectionSlug}" is a ${connection.provider} connection; expected ${params.expectedProvider}.`,
        path: params.path,
        details: {
          connection: connectionSlug,
          provider: connection.provider,
          expectedProvider: params.expectedProvider,
          ...params.details,
        },
      }),
    );
    return undefined;
  }

  const catalog = params.context.agentToolSelectionCatalogs.get(connection.provider);
  if (catalog === undefined || !connection.capabilities.includes('agent_tools')) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-capable',
        message: `Integration connection "${connectionSlug}" does not support agent tools.`,
        path: params.path,
        details: {
          connection: connectionSlug,
          provider: connection.provider,
          capabilities: connection.capabilities,
          ...params.details,
        },
      }),
    );
    return undefined;
  }

  return new Map(catalog.selectors.map((selector) => [selector.token, selector]));
}

/**
 * Checks selectors against the provider catalog. A selection that `exclude` empties is refused,
 * and write tools need `allowWrite`.
 */
export function validateAgentToolSelection(params: {
  include: readonly string[];
  exclude?: readonly string[];
  allowWrite: boolean;
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  selectorPath: (field: 'include' | 'exclude', tokenIndex?: number) => readonly (string | number)[];
  details?: Readonly<Record<string, unknown>>;
  issues: WorkflowModelValidationIssue[];
}): void {
  validateSelection({...params, field: 'include', tokens: params.include});
  if (params.exclude !== undefined) {
    validateSelection({...params, field: 'exclude', tokens: params.exclude});
  }
  if (!selectsKnownTokensOnly(params)) return;
  validateEffectiveSelection(params);
}

function validateSelection(params: {
  field: 'include' | 'exclude';
  tokens: readonly string[];
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  selectorPath: (field: 'include' | 'exclude', tokenIndex?: number) => readonly (string | number)[];
  details?: Readonly<Record<string, unknown>>;
  issues: WorkflowModelValidationIssue[];
}): void {
  params.tokens.forEach((token, tokenIndex) => {
    if (params.selectorsByToken.has(token)) return;

    const code = classifyUnknownSelection(token, params.selectorsByToken);
    params.issues.push(
      issue({
        code,
        message:
          code === 'unknown-integration-method'
            ? `Unknown integration tool method: ${token}.`
            : `Unknown integration tool: ${token}.`,
        path: params.selectorPath(params.field, tokenIndex),
        details: {token, ...params.details},
      }),
    );
  });
}

function selectsKnownTokensOnly(params: {
  include: readonly string[];
  exclude?: readonly string[];
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
}): boolean {
  return [...params.include, ...(params.exclude ?? [])].every((token) =>
    params.selectorsByToken.has(token),
  );
}

function validateEffectiveSelection(params: {
  include: readonly string[];
  exclude?: readonly string[];
  allowWrite: boolean;
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  selectorPath: (field: 'include' | 'exclude', tokenIndex?: number) => readonly (string | number)[];
  details?: Readonly<Record<string, unknown>>;
  issues: WorkflowModelValidationIssue[];
}): void {
  const excluded = new Set(
    (params.exclude ?? []).flatMap((token) => grantedTokens(token, params.selectorsByToken)),
  );
  const remaining = (token: string) =>
    grantedTokens(token, params.selectorsByToken).filter((granted) => !excluded.has(granted));

  if (params.include.every((token) => remaining(token).length === 0)) {
    params.issues.push(
      issue({
        code: 'integration-no-tools-selected',
        message:
          'Integration selection leaves no tools after exclude removes what include selects.',
        path: params.selectorPath('include'),
        details: {...params.details},
      }),
    );
    return;
  }
  if (params.allowWrite) return;

  const writeTokens = dedupe(
    params.include.filter((token) =>
      remaining(token).some(
        (granted) => params.selectorsByToken.get(granted)?.sensitivity === 'write',
      ),
    ),
  );
  if (writeTokens.length === 0) return;

  params.issues.push(
    issue({
      code: 'integration-write-not-allowed',
      message: `Integration selection includes write-capable tools but allow_write is not true: ${writeTokens.join(', ')}.`,
      path: params.selectorPath('include'),
      details: {tokens: writeTokens, ...params.details},
    }),
  );
}

/** The standalone tools and family methods a token selects. Unknown tokens select nothing. */
function grantedTokens(
  token: string,
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>,
): readonly string[] {
  const selector = selectorsByToken.get(token);
  if (selector === undefined) return [];
  if (selector.kind === 'standalone' || selector.kind === 'method') return [token];

  const family = selector.kind === 'family_wildcard' ? token.slice(0, -'.*'.length) : token;
  const methods = [...selectorsByToken.values()]
    .filter((candidate) => candidate.kind === 'method' && candidate.token.startsWith(`${family}.`))
    .map((candidate) => candidate.token);
  return methods.length === 0 ? [family] : methods;
}

function classifyUnknownSelection(
  token: string,
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>,
): 'unknown-integration-method' | 'unknown-integration-tool' {
  const dotIndex = token.indexOf('.');
  if (dotIndex < 1) return 'unknown-integration-tool';

  const family = token.slice(0, dotIndex);
  return selectorsByToken.get(family)?.kind === 'family'
    ? 'unknown-integration-method'
    : 'unknown-integration-tool';
}

function integrationConnectionPath(params: {
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
  integration: WorkflowDocumentStepIntegration;
}): readonly (string | number)[] {
  const path = integrationPath(params);
  if (params.integration.connection === undefined) return path;
  return [...path, 'connection'];
}

function integrationPath(params: {
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
}): readonly (string | number)[] {
  return [
    'jobs',
    params.sourceName,
    'steps',
    params.stepIndex,
    'integrations',
    params.integrationIndex,
  ];
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

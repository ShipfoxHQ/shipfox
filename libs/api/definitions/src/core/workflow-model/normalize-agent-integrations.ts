import type {AgentToolSelector} from '@shipfox/api-integration-core-dto';
import type {WorkflowDocumentStepIntegration} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModelStepIntegration} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

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

function normalizeIntegration(
  integration: WorkflowDocumentStepIntegration,
): WorkflowModelStepIntegration {
  return {
    ...(integration.connection === undefined ? {} : {connection: integration.connection}),
    include: dedupe(integration.include),
    ...(integration.exclude === undefined ? {} : {exclude: dedupe(integration.exclude)}),
    allowWrite: integration.allow_write ?? false,
    ...(integration.repos === undefined ? {} : {repos: dedupe(integration.repos)}),
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

  const connection = context.workspaceConnectionSnapshot.get(connectionSlug);
  if (connection === undefined) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-found',
        message: `Integration connection "${connectionSlug}" was not found in the workspace.`,
        path: integrationConnectionPath(params),
        details: {
          connection: connectionSlug,
          integrationIndex: params.integrationIndex,
        },
      }),
    );
    return;
  }

  const catalog = context.agentToolSelectionCatalogs.get(connection.provider);
  if (catalog === undefined || !connection.capabilities.includes('agent_tools')) {
    params.issues.push(
      issue({
        code: 'integration-connection-not-capable',
        message: `Integration connection "${connectionSlug}" does not support agent tools.`,
        path: integrationConnectionPath(params),
        details: {
          connection: connectionSlug,
          provider: connection.provider,
          capabilities: connection.capabilities,
          integrationIndex: params.integrationIndex,
        },
      }),
    );
    return;
  }

  const selectorsByToken = new Map(catalog.selectors.map((selector) => [selector.token, selector]));
  validateSelection({
    ...params,
    field: 'include',
    tokens: params.normalized.include,
    selectorsByToken,
  });
  if (params.normalized.exclude !== undefined) {
    validateSelection({
      ...params,
      field: 'exclude',
      tokens: params.normalized.exclude,
      selectorsByToken,
    });
  }
  validateWriteSelection({...params, selectorsByToken});
}

function validateSelection(params: {
  field: 'include' | 'exclude';
  tokens: readonly string[];
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
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
        path: [...integrationPath(params), params.field, tokenIndex],
        details: {token},
      }),
    );
  });
}

function validateWriteSelection(params: {
  normalized: WorkflowModelStepIntegration;
  selectorsByToken: ReadonlyMap<string, AgentToolSelector>;
  sourceName: string;
  stepIndex: number;
  integrationIndex: number;
  issues: WorkflowModelValidationIssue[];
}): void {
  if (params.normalized.allowWrite) return;

  const writeTokens = params.normalized.include.filter(
    (token) => params.selectorsByToken.get(token)?.sensitivity === 'write',
  );
  if (writeTokens.length === 0) return;

  params.issues.push(
    issue({
      code: 'integration-write-not-allowed',
      message: `Integration selection includes write-capable tools but allow_write is not true: ${writeTokens.join(', ')}.`,
      path: [...integrationPath(params), 'include'],
      details: {tokens: writeTokens},
    }),
  );
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

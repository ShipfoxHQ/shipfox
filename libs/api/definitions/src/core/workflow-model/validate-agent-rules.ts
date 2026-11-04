import {
  createWorkflowExpression,
  type ExpressionType,
  InvalidWorkflowExpressionError,
  jsonSchemaToExpressionType,
} from '@shipfox/expression';
import type {AgentRule} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {connectionNotAllowedIssue} from './normalize-agent-integrations.js';
import {issue} from './validation-issue.js';

/** The JSON Schema of `request`, per provider with the interaction capability. */
export type InteractionRequestSchemas = ReadonlyMap<string, Readonly<Record<string, unknown>>>;

const OPEN_MAP: ExpressionType = {kind: 'map'};
// Triggers indexes the filter text, and a btree entry over about 2.7 KB fails the insert.
const MAX_AGENT_RULE_FILTER_BYTES = 2000;

/**
 * Checks each `on:` rule of an agent file. The source must be a connection that lets people talk
 * to agents. The filter reads `request`, typed from the provider's context schema, and `event`,
 * the raw payload. Without the workspace context, only the filter's syntax can be checked.
 */
export function validateAgentRules(params: {
  rules: readonly AgentRule[] | undefined;
  integrationValidationContext: IntegrationValidationContext | undefined;
  requestSchemas: InteractionRequestSchemas | undefined;
  issues: WorkflowModelValidationIssue[];
}): void {
  params.rules?.forEach((rule, index) => {
    const requestType = resolveRequestType({...params, rule, index});
    if (requestType === undefined || rule.filter === undefined) return;
    validateRuleFilter({
      filter: rule.filter,
      requestType,
      path: ['on', index, 'filter'],
      issues: params.issues,
    });
  });
}

/** The type of `request` for a rule, or `undefined` when the rule is already refused. */
function resolveRequestType(params: {
  rule: AgentRule;
  index: number;
  integrationValidationContext: IntegrationValidationContext | undefined;
  requestSchemas: InteractionRequestSchemas | undefined;
  issues: WorkflowModelValidationIssue[];
}): ExpressionType | undefined {
  const {rule, index, issues} = params;
  const context = params.integrationValidationContext;
  if (context === undefined) return OPEN_MAP;

  const path = ['on', index, 'source'] as const;
  const connection = context.workspaceConnectionSnapshot.get(rule.source);
  if (connection === undefined) {
    issues.push(
      issue({
        code: 'integration-connection-not-found',
        message: `Integration connection "${rule.source}" was not found in the workspace.`,
        path,
        details: {connection: rule.source, ruleIndex: index},
      }),
    );
    return undefined;
  }

  if (!connection.capabilities.includes('interaction')) {
    issues.push(
      issue({
        code: 'integration-connection-not-capable',
        message: `Integration connection "${rule.source}" does not let people talk to agents.`,
        path,
        details: {
          connection: rule.source,
          provider: connection.provider,
          capabilities: connection.capabilities,
          ruleIndex: index,
        },
      }),
    );
    return undefined;
  }

  if (!connection.allowed) {
    issues.push(connectionNotAllowedIssue({connectionSlug: rule.source, path}));
  }
  const requestSchema = params.requestSchemas?.get(connection.provider);
  return requestSchema === undefined ? OPEN_MAP : requestTypeFromSchema(requestSchema);
}

function validateRuleFilter(params: {
  filter: string;
  requestType: ExpressionType;
  path: readonly (string | number)[];
  issues: WorkflowModelValidationIssue[];
}): void {
  if (Buffer.byteLength(params.filter, 'utf8') > MAX_AGENT_RULE_FILTER_BYTES) {
    params.issues.push(
      issue({
        code: 'invalid-agent-rule-filter',
        message: `An agent rule filter cannot be longer than ${MAX_AGENT_RULE_FILTER_BYTES} bytes.`,
        path: params.path,
        details: {maximum: MAX_AGENT_RULE_FILTER_BYTES},
      }),
    );
    return;
  }
  try {
    createWorkflowExpression({
      source: params.filter,
      check: {
        mode: 'typed',
        typeEnvironment: {request: params.requestType, event: OPEN_MAP},
        expectedResultType: 'bool',
      },
    });
  } catch (error) {
    if (!(error instanceof InvalidWorkflowExpressionError)) throw error;
    params.issues.push(
      issue({
        code: 'invalid-agent-rule-filter',
        message: `An agent rule filter must be a boolean condition on "request" and "event": ${error.reason}`,
        path: params.path,
        details: {source: params.filter, reason: error.reason},
      }),
    );
  }
}

/**
 * Types `request` from the `properties` of the provider's context schema, so a filter on a field
 * the provider never sets is refused. Optional fields stay in the type: a filter may test for
 * them, and a request without one fails the filter closed.
 */
function requestTypeFromSchema(schema: Readonly<Record<string, unknown>>): ExpressionType {
  const {properties} = schema;
  if (schema.type !== 'object' || typeof properties !== 'object' || properties === null) {
    return OPEN_MAP;
  }
  return {
    kind: 'object',
    fields: Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [
        name,
        jsonSchemaToExpressionType(property),
      ]),
    ),
  };
}

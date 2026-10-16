import {sanitizeAgentIntegrationConnectionSlug} from '@shipfox/api-agent-dto';
import type {AvailabilitySite, ExpressionTypeEnvironment} from '@shipfox/expression';
import type {WorkflowDocumentStep} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {
  WorkflowModelAgentMcpServer,
  WorkflowModelStepIntegration,
} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {normalizeEnv} from './normalize-env.js';
import {unescapeLiteralName} from './validate-literal-name.js';
import {issue} from './validation-issue.js';

export function normalizeAgentMcpServers(params: {
  servers: WorkflowDocumentStep['mcp_servers'];
  integrations: readonly WorkflowModelStepIntegration[] | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): {readonly customMcpServers?: readonly WorkflowModelAgentMcpServer[]} {
  if (params.servers === undefined) return {};
  const servers = Object.entries(params.servers).map(([name, server]) =>
    normalizeAgentMcpServer({...params, name, server}),
  );
  validatePrefixCollisions({...params, servers});
  return {customMcpServers: servers};
}

function normalizeAgentMcpServer(params: {
  name: string;
  server: NonNullable<WorkflowDocumentStep['mcp_servers']>[string];
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowModelAgentMcpServer {
  const {name, server} = params;
  const include = server.include === undefined ? {} : {include: [...new Set(server.include)]};
  const normalizeValues = (kind: 'env' | 'headers') =>
    normalizeEnv({
      env: server[kind],
      field: `agent.mcp_servers.${kind}.value`,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'mcp_servers', name, kind],
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay: params.typeOverlay,
    });
  // The document schema allows exactly one of `command` and `url`.
  if (server.url !== undefined) {
    const {env: headers, templates} = normalizeValues('headers');
    return {
      name,
      url: unescapeLiteralName(server.url),
      ...(headers === undefined ? {} : {headers: {...headers}}),
      ...include,
      ...(templates === undefined ? {} : {templates: {headers: templates.env}}),
    };
  }
  const {env, templates} = normalizeValues('env');
  return {
    name,
    command: unescapeLiteralName(server.command ?? ''),
    args: (server.args ?? []).map(unescapeLiteralName),
    ...(env === undefined ? {} : {env: {...env}}),
    ...include,
    ...(templates === undefined ? {} : {templates}),
  };
}

// Integration tools reach the agent as `<sanitized slug>__<tool>`, the same shape as custom
// server tools. The default connection is checked when the definition knows it; materialization
// checks again once it resolves the connection.
function validatePrefixCollisions(params: {
  servers: readonly WorkflowModelAgentMcpServer[];
  integrations: readonly WorkflowModelStepIntegration[] | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  integrationValidationContext?: IntegrationValidationContext | undefined;
}): void {
  const prefixes = new Set<string>();
  for (const integration of params.integrations ?? []) {
    const slug =
      integration.connection ?? params.integrationValidationContext?.defaultConnectionSlug;
    if (slug !== undefined) prefixes.add(sanitizeAgentIntegrationConnectionSlug(slug));
  }
  for (const server of params.servers) {
    if (!prefixes.has(server.name)) continue;
    params.issues.push(
      issue({
        code: 'agent-mcp-server-name-collision',
        message: `MCP server "${server.name}" has the same tool prefix as an integration connection on this step. Rename the server.`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'mcp_servers', server.name],
        details: {server: server.name},
      }),
    );
  }
}

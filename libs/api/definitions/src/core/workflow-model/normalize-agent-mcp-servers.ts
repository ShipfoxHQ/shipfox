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
  const stepPath = ['jobs', params.sourceName, 'steps', params.stepIndex] as const;
  const servers = Object.entries(params.servers).map(
    ([name, server]): WorkflowModelAgentMcpServer => {
      const {env, templates} = normalizeEnv({
        env: server.env,
        field: 'agent.mcp_servers.env.value',
        path: [...stepPath, 'mcp_servers', name, 'env'],
        issues: params.issues,
        fillSite: params.fillSite,
        allowedJobReferences: params.allowedJobReferences,
        typeOverlay: params.typeOverlay,
      });
      return {
        name,
        command: unescapeLiteralName(server.command),
        args: (server.args ?? []).map(unescapeLiteralName),
        ...(env === undefined ? {} : {env: {...env}}),
        ...(server.include === undefined ? {} : {include: [...new Set(server.include)]}),
        ...(templates === undefined ? {} : {templates}),
      };
    },
  );
  validatePrefixCollisions({...params, servers});
  return {customMcpServers: servers};
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

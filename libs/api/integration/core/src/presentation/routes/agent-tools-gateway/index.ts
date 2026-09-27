import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {AUTH_LEASED_JOB, requireLeasedJobContext} from '@shipfox/api-auth-context';
import {reportError} from '@shipfox/node-error-monitoring';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {WorkspaceBuiltinConnection} from '#core/agent-tool-selection.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {RepositoryAuthorizer} from '#core/repository-authorizer.js';
import {createIntegrationToolCallRecorder} from '#core/tool-call-audit.js';
import type {GetIntegrationConnectionByIdFn} from '#db/connections.js';
import {createIntegrationToolDispatcher} from './dispatch.js';
import {buildAgentToolsMcpServer} from './mcp-server.js';
import {
  type LeasedAgentStepLoader,
  resolveAuthorizedIntegrationTools,
} from './resolve-authorized-tools.js';

// A create_commit near its 1,000,000 decoded-byte file limit grows past Fastify's 1 MiB default
// once base64 and JSON framing are added. The runner bridge caps requests at the same size.
const GATEWAY_MCP_BODY_LIMIT = 2 * 1024 * 1024;

export type {LeasedAgentStepLoader} from './resolve-authorized-tools.js';
export {createWorkflowsLeasedAgentStepLoader} from './resolve-authorized-tools.js';

export interface CreateAgentToolsGatewayRoutesParams {
  loadLeasedAgentStep: LeasedAgentStepLoader;
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  builtinConnections?: readonly WorkspaceBuiltinConnection[] | undefined;
  repositoryAuthorizer?: RepositoryAuthorizer | undefined;
}

export function createAgentToolsGatewayRoutes(
  params: CreateAgentToolsGatewayRoutesParams,
): RouteGroup {
  return {
    prefix: '/runs/jobs/current/integration-tools',
    auth: AUTH_LEASED_JOB,
    routes: [
      defineRoute({
        method: 'POST',
        path: '/mcp',
        description: 'Gateway MCP endpoint for integration-backed agent tools',
        options: {bodyLimit: GATEWAY_MCP_BODY_LIMIT},
        handler: async (request, reply) => {
          const lease = requireLeasedJobContext(request);
          const authorizedTools = await resolveAuthorizedIntegrationTools({
            request,
            loadLeasedAgentStep: params.loadLeasedAgentStep,
            registry: params.registry,
            getIntegrationConnectionById: params.getIntegrationConnectionById,
            builtinConnections: params.builtinConnections,
          });
          const server = buildAgentToolsMcpServer({
            authorizedTools,
            dispatch: createIntegrationToolDispatcher({
              registry: params.registry,
              lease,
              repositoryAuthorizer: params.repositoryAuthorizer,
            }),
            recordCall: createIntegrationToolCallRecorder({caller: 'agent', lease}),
          });
          const transport = new StreamableHTTPServerTransport();

          await server.connect(transport as unknown as Transport);
          reply.raw.on('close', () => {
            void transport.close().catch((error) => {
              logger().error({err: error}, 'Failed to close integration agent tool transport');
              reportError(error, {
                boundary: 'integration.agent-tool',
                operation: 'close-transport',
              });
            });
            void server.close().catch((error) => {
              logger().error({err: error}, 'Failed to close integration agent tool server');
              reportError(error, {
                boundary: 'integration.agent-tool',
                operation: 'close-server',
              });
            });
          });

          reply.hijack();
          await transport.handleRequest(request.raw, reply.raw, request.body);
        },
      }),
    ],
  };
}

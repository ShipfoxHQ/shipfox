import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {IntegrationToolDispatchInput} from './mcp-server.js';

export async function dispatchIntegrationToolCall(
  input: IntegrationToolDispatchInput,
): Promise<CallToolResult> {
  await Promise.resolve();

  const structuredContent = {
    status: 'stubbed',
    provider: input.authorizedTool.integration.provider,
    connection_id: input.authorizedTool.integration.connectionId,
    tool_id: input.authorizedTool.tool.id,
    ...(input.method ? {method: input.method} : {}),
  };

  return {
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

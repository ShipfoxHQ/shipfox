import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {IntegrationProviderError} from '#core/errors.js';
import type {
  AgentToolCatalogEntry,
  AgentToolCatalogMethod,
  AgentToolSession,
  AgentToolsProvider,
} from '#core/providers/agent-tools.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {IntegrationToolDispatcher, IntegrationToolDispatchInput} from './mcp-server.js';

export interface CreateIntegrationToolDispatcherParams {
  registry: IntegrationProviderRegistry;
}

const timeoutErrorPattern = /timed?\s*out|timeout/i;
const credentialErrorNamePattern = /Token|Credential|Secret|AccessToken/;

export function createIntegrationToolDispatcher(
  params: CreateIntegrationToolDispatcherParams,
): IntegrationToolDispatcher {
  return (input) => dispatchIntegrationToolCall({...input, registry: params.registry});
}

async function dispatchIntegrationToolCall(
  input: IntegrationToolDispatchInput & {registry: IntegrationProviderRegistry},
): Promise<CallToolResult> {
  let session: AgentToolSession<CallToolResult> | undefined;

  try {
    const adapter = input.registry.getAdapter(
      input.authorizedTool.integration.provider,
      'agent_tools',
    ) as AgentToolsProvider<
      typeof input.authorizedTool.connection,
      unknown,
      typeof input.authorizedTool.integration,
      unknown,
      CallToolResult
    >;
    session = await adapter.openSession({
      connection: input.authorizedTool.connection,
      tools: [agentToolCatalogEntry(input)],
      scope: input.authorizedTool.integration,
      mintToken: async (requiredScope) => requiredScope,
    });

    return await session.call({
      toolId: input.authorizedTool.tool.id,
      arguments: input.arguments,
    });
  } catch (error) {
    return toolError(errorResult(error));
  } finally {
    await closeSession(session);
  }
}

function agentToolCatalogEntry(input: IntegrationToolDispatchInput): AgentToolCatalogEntry {
  const {tool, description, inputSchema, outputSchema} = input.authorizedTool;
  return {
    id: tool.id,
    description,
    sensitivity: tool.sensitivity,
    sensitive: tool.sensitive,
    requiredScope: tool.requiredScope,
    inputSchema,
    ...(outputSchema === undefined ? {} : {outputSchema}),
    ...(tool.methods === undefined
      ? {}
      : {
          methods: tool.methods.map(
            (method): AgentToolCatalogMethod => ({
              id: method.id,
              description: method.description ?? method.token,
              sensitivity: method.sensitivity,
              sensitive: method.sensitive,
              requiredScope: method.requiredScope,
            }),
          ),
        }),
  };
}

async function closeSession(session: {close?(): Promise<void>} | undefined): Promise<void> {
  try {
    await session?.close?.();
  } catch {
    // Cleanup must not mask the tool result returned to the runner.
  }
}

function errorResult(error: unknown): {code: string; message: string} {
  if (error instanceof IntegrationProviderError) {
    return {
      code: error.reason,
      message: `Integration provider error: ${error.reason}`,
    };
  }

  if (isTimeoutError(error)) {
    return {
      code: 'provider-timeout',
      message: 'Integration provider timed out',
    };
  }

  if (isCredentialError(error)) {
    return {
      code: 'credentials-unavailable',
      message: 'Integration provider credentials are unavailable',
    };
  }

  return {
    code: 'provider-unavailable',
    message: 'Integration provider call failed',
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    timeoutErrorPattern.test(error.name) ||
    timeoutErrorPattern.test(error.message)
  );
}

function isCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return credentialErrorNamePattern.test(error.name);
}

function toolError(params: {code: string; message: string}): CallToolResult {
  return {
    isError: true,
    content: [{type: 'text', text: params.message}],
    structuredContent: {code: params.code},
  };
}

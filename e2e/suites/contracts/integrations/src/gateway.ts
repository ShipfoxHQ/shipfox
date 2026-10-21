import {randomUUID} from 'node:crypto';
import {
  createIntegrationProviderRegistry,
  createIntegrationsInterModulePresentation,
  type IntegrationConnection,
  type IntegrationProviderRegistry,
} from '@shipfox/api-integration-core';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import type {AgentToolCatalogEntry, AgentToolsProvider} from '@shipfox/api-integration-spi';
import type {ContractFake} from './fakes/shared.js';
import {claapContractTools} from './providers/claap.js';
import {clickupContractTools} from './providers/clickup.js';
import {discordContractTools} from './providers/discord.js';
import {githubContractTools} from './providers/github.js';
import {jamContractTools} from './providers/jam.js';
import {jiraContractTools} from './providers/jira.js';
import {linearContractTools} from './providers/linear.js';
import {notionContractTools} from './providers/notion.js';
import {posthogContractTools} from './providers/posthog.js';
import {slackContractTools} from './providers/slack.js';

// The provider packages read their configuration when they load, so only the stack imports this
// module, once the fakes run and their addresses are in the environment.

type ContractTools = (access: never) => AgentToolsProvider<IntegrationConnection>;

/** The tool adapter of each provider the suite runs, built over its fake. */
const CONTRACT_TOOLS: Readonly<Record<string, ContractTools>> = {
  claap: claapContractTools as ContractTools,
  clickup: clickupContractTools as ContractTools,
  discord: discordContractTools as ContractTools,
  github: githubContractTools as ContractTools,
  jam: jamContractTools as ContractTools,
  jira: jiraContractTools as ContractTools,
  linear: linearContractTools as ContractTools,
  notion: notionContractTools as ContractTools,
  posthog: posthogContractTools as ContractTools,
  slack: slackContractTools as ContractTools,
};

export interface ContractToolCall {
  provider: string;
  tool: string;
  method?: string | undefined;
  with: Record<string, unknown>;
}

/** What a tool step ends with: the `result` its checks read, or the error code it fails with. */
export type ContractToolOutcome =
  | {outcome: 'success'; result: unknown}
  | {outcome: 'error'; code: string; message: string};

export interface ContractGateway {
  call(call: ContractToolCall): Promise<ContractToolOutcome>;
}

/**
 * The integrations module's own `callTool` handler over a registry of the fakes' tool adapters.
 * A call takes the path a tool step takes from the workflows module on: the live catalog check,
 * the method check, the provider session, and the mapping of its errors to codes.
 */
export function createContractGateway({
  fakes,
}: {
  fakes: Readonly<Record<string, ContractFake>>;
}): ContractGateway {
  const workspaceId = randomUUID();
  const connections = new Map<string, IntegrationConnection>();
  const connectionIds = new Map<string, string>();
  const providers = Object.entries(fakes).map(([provider, fake]) => {
    const tools = CONTRACT_TOOLS[provider];
    if (tools === undefined) {
      throw new Error(`The ${provider} fake has no tool adapter in the contracts gateway.`);
    }
    const connection = contractConnection({workspaceId, provider});
    connections.set(connection.id, connection);
    connectionIds.set(provider, connection.id);
    return {
      provider,
      displayName: provider,
      adapters: {agent_tools: tools(fake.access as never)},
    };
  });
  const registry = createIntegrationProviderRegistry(providers);
  const presentation = createIntegrationsInterModulePresentation({
    registry,
    sourceControl: {} as never,
    getIntegrationConnectionById: (id) => Promise.resolve(connections.get(id)),
    createIntegrationToolCallRecorder: () => () => undefined,
  });
  const contract = integrationsInterModuleContract.methods.callTool;

  return {
    call: async (call) => {
      const connectionId = connectionIds.get(call.provider);
      if (connectionId === undefined) {
        throw new Error(`No ${call.provider} connection in the contracts gateway.`);
      }
      const tool = await frozenTool({registry, call});
      const input = contract.input.parse({
        workspaceId,
        connectionId,
        tool,
        // The server adds the method of a `family.method` tool to its arguments.
        arguments: call.method === undefined ? call.with : {...call.with, method: call.method},
        caller: {
          kind: 'tool_step',
          projectId: randomUUID(),
          runId: randomUUID(),
          jobExecutionId: randomUUID(),
          stepId: randomUUID(),
          stepAttempt: 1,
          callIndex: 0,
        },
      });
      let output: Awaited<ReturnType<typeof presentation.handlers.callTool>>;
      try {
        output = await presentation.handlers.callTool(input, {signal: AbortSignal.timeout(30_000)});
      } catch (error) {
        return {outcome: 'error', code: errorCode(error), message: errorMessage(error)};
      }
      if (output.outcome === 'error') {
        return {outcome: 'error', code: output.code, message: output.message};
      }
      // The run stores the result as JSON, so the checks see what survives that.
      return {outcome: 'success', result: JSON.parse(JSON.stringify(toolResult(output)) ?? 'null')};
    },
  };
}

function contractConnection({
  workspaceId,
  provider,
}: {
  workspaceId: string;
  provider: string;
}): IntegrationConnection {
  const now = new Date();
  return {
    id: randomUUID(),
    workspaceId,
    provider,
    externalAccountId: `contracts-${provider}`,
    slug: `${provider}_fake`,
    displayName: `Contracts ${provider}`,
    lifecycleStatus: 'active',
    repositoryAccessMode: 'all',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The tool as the definitions compiler freezes it into a step: the catalog entry, with the
 * method's sensitivity and scope for a method of a family. An unknown tool keeps its id, so the
 * handler rejects it as a tool step would be.
 */
async function frozenTool({
  registry,
  call,
}: {
  registry: IntegrationProviderRegistry;
  call: ContractToolCall;
}) {
  const catalog: readonly AgentToolCatalogEntry[] = await registry
    .getAdapter(call.provider, 'agent_tools')
    .catalog();
  const entry = catalog.find((candidate) => candidate.id === call.tool);
  if (entry === undefined) {
    return {
      id: call.tool,
      provider: call.provider,
      sensitivity: 'read' as const,
      sensitive: false,
      requiredScope: [],
      inputSchema: {},
    };
  }
  const method = entry.methods?.find((candidate) => candidate.id === call.method);
  return {
    id: entry.id,
    provider: call.provider,
    sensitivity: method?.sensitivity ?? entry.sensitivity,
    sensitive: method?.sensitive ?? entry.sensitive,
    requiredScope: requiredScope(method?.requiredScope ?? entry.requiredScope),
    inputSchema: entry.inputSchema,
    ...(entry.outputSchema === undefined ? {} : {outputSchema: entry.outputSchema}),
  };
}

function requiredScope(scope: unknown): unknown[] {
  return Array.isArray(scope) ? [...scope] : [scope];
}

/** The structured result, or else the first text block, parsed when it is JSON. */
function toolResult(output: {result: unknown; content: Array<Record<string, unknown>>}): unknown {
  if (output.result !== null) return output.result;
  const text = output.content.find(
    (block) => block.type === 'text' && typeof block.text === 'string',
  );
  if (text === undefined || typeof text.text !== 'string') return null;
  try {
    return JSON.parse(text.text) as unknown;
  } catch {
    return text.text;
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const {code} = error as {code: unknown};
    if (typeof code === 'string') return code;
  }
  return 'tool_error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

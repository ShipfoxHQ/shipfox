import type {
  AgentToolCatalogEntry,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  DISCORD_TOOL_OPERATIONS,
  type DiscordToolClient,
  type DiscordToolContext,
  type DiscordToolOperation,
} from '#core/agent-tool-operations.js';
import {
  type DiscordAgentToolRequiredScope,
  discordAgentToolCatalog,
  discordAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import {createDiscordChannelGuard} from '#core/channel-guard.js';
import {DiscordIntegrationProviderError, DiscordToolArgumentError} from '#core/errors.js';
import type {DiscordInstallation} from '#db/installations.js';

type DiscordIntegrationConnection = IntegrationConnection<'discord'>;
type DiscordToolCall = Parameters<AgentToolSession<DiscordToolCallResult>['call']>[0];

export type DiscordToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

export interface DiscordAgentToolsProviderOptions {
  discord: DiscordToolClient;
  getInstallationByConnectionId: (connectionId: string) => Promise<DiscordInstallation | undefined>;
}

export class DiscordAgentToolsProvider
  implements
    AgentToolsProvider<
      DiscordIntegrationConnection,
      DiscordAgentToolRequiredScope,
      unknown,
      DiscordToolCallResult
    >
{
  private readonly guard: ReturnType<typeof createDiscordChannelGuard>;

  constructor(private readonly options: DiscordAgentToolsProviderOptions) {
    this.guard = createDiscordChannelGuard(options.discord);
  }

  catalog() {
    return discordAgentToolCatalog;
  }

  selectionCatalog() {
    return discordAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<
      DiscordIntegrationConnection,
      DiscordAgentToolRequiredScope,
      unknown
    >,
  ): Promise<AgentToolSession<DiscordToolCallResult>> {
    const installation = await this.options.getInstallationByConnectionId(input.connection.id);
    if (!installation || installation.status === 'removed') {
      throw new DiscordIntegrationProviderError({
        reason: 'credentials-unavailable',
        message: 'The Discord bot is not in this server. Reconnect Discord and try again.',
      });
    }
    const context: DiscordToolContext = {
      discord: this.options.discord,
      guildId: installation.guildId,
      guard: this.guard,
    };

    return {
      call: (call) =>
        executeDiscordToolCall({
          call,
          tools: input.tools,
          connectionId: input.connection.id,
          context,
        }),
      close: () => Promise.resolve(),
    };
  }
}

async function executeDiscordToolCall(params: {
  call: DiscordToolCall;
  tools: readonly AgentToolCatalogEntry<DiscordAgentToolRequiredScope>[];
  connectionId: string;
  context: DiscordToolContext;
}): Promise<DiscordToolCallResult> {
  const {call} = params;
  const tool = params.tools.find((candidate) => candidate.id === call.toolId);
  const operation = tool
    ? DISCORD_TOOL_OPERATIONS[call.toolId as keyof typeof DISCORD_TOOL_OPERATIONS]
    : undefined;
  if (!tool || !operation) {
    return discordToolError(`Unknown Discord tool: ${call.toolId}`, 'invalid-request');
  }
  const validationError =
    validateDiscordToolArguments(tool, call.arguments) ?? operation.validate?.(call.arguments);
  if (validationError) return discordToolError(validationError, 'invalid-request');

  try {
    return discordToolResult(await operation.run(call.arguments, params.context));
  } catch (error) {
    if (error instanceof DiscordIntegrationProviderError) {
      return mapDiscordToolFailure({error, call, operation, connectionId: params.connectionId});
    }
    if (error instanceof DiscordToolArgumentError) {
      return discordToolError(error.message, 'invalid-request');
    }
    throw error;
  }
}

function mapDiscordToolFailure(params: {
  error: DiscordIntegrationProviderError;
  call: DiscordToolCall;
  operation: DiscordToolOperation;
  connectionId: string;
}): DiscordToolCallResult {
  const {error, call, operation} = params;
  switch (error.reason) {
    case 'credentials-unavailable':
      logger().error(
        {connectionId: params.connectionId, toolId: call.toolId},
        'Discord rejected the bot token',
      );
      reportError(error, {
        boundary: 'discord.agent-tools',
        operation: call.toolId,
        extra: {connectionId: params.connectionId},
      });
      return discordToolError(
        'Discord credentials are unavailable. Try again later.',
        'credentials-unavailable',
      );
    case 'access-denied':
      // Only answers from Discord carry a status. Boundary rejections keep their own message.
      return discordToolError(
        error.status === undefined
          ? error.message
          : `Discord denied access to ${channelLabel(call.arguments)}.${
              operation.permissionHint === undefined
                ? ''
                : ` The bot probably lacks the ${operation.permissionHint} permission there.`
            }`,
        'access-denied',
      );
    case 'not-found':
      // One answer for a missing channel and a channel in another server.
      return discordToolError('Not found in this server', 'not-found');
    case 'rate-limited':
      return discordToolError(error.message, 'rate-limited', error.retryAfterSeconds);
    case 'timeout':
    case 'provider-unavailable':
      return discordToolError('Discord is unavailable. Try again later.', 'provider-unavailable');
    default:
      return discordToolError(error.message, error.reason);
  }
}

function channelLabel(args: Record<string, unknown>): string {
  return typeof args.channel_id === 'string' ? `channel ${args.channel_id}` : 'this server';
}

function validateDiscordToolArguments(
  tool: AgentToolCatalogEntry<DiscordAgentToolRequiredScope>,
  args: Record<string, unknown>,
): string | undefined {
  const schema = tool.inputSchema;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.find((name) => typeof name === 'string' && args[name] === undefined);
  if (typeof missing === 'string') return `Missing required parameter: ${missing}`;

  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const [name, value] of Object.entries(args)) {
    const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!isRecord(property)) {
      if (schema.additionalProperties === false) return `Unknown parameter: ${name}`;
      continue;
    }
    const error = validateArgument(name, value, property);
    if (error !== undefined) return error;
  }
  return undefined;
}

function validateArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (schema.type === 'string') return validateStringArgument(name, value, schema);
  if (schema.type === 'integer') return validateIntegerArgument(name, value, schema);
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return `Parameter ${name} must be a boolean`;
  }
  return undefined;
}

function validateStringArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (typeof value !== 'string') return `Parameter ${name} must be a string`;
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
    return `Parameter ${name} has an invalid format`;
  }
  return undefined;
}

function validateIntegerArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return `Parameter ${name} must be an integer`;
  }
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    return `Parameter ${name} must be at least ${schema.minimum}`;
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    return `Parameter ${name} must be at most ${schema.maximum}`;
  }
  return undefined;
}

function discordToolResult(body: Record<string, unknown>): DiscordToolCallResult {
  return {content: [{type: 'text', text: JSON.stringify(body)}], structuredContent: body};
}

function discordToolError(
  message: string,
  code: string,
  retryAfterSeconds?: number | undefined,
): DiscordToolCallResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent: {code, ...(retryAfterSeconds === undefined ? {} : {retryAfterSeconds})},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

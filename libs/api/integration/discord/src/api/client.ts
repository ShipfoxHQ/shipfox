import type {discordCommandDefinitions} from '@shipfox/api-integration-discord-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {DiscordIntegrationProviderError} from '#core/errors.js';

export const DISCORD_API_TIMEOUT_MS = 10_000;

const TRAILING_SLASHES_RE = /\/+$/;

export interface DiscordRole {
  id: string;
  name: string;
  managed: boolean;
  tags?: {bot_id?: string} | undefined;
}

export interface DiscordGuild {
  id: string;
  name: string;
  roles: DiscordRole[];
}

export interface DiscordChannel {
  id: string;
  type: number;
  guild_id?: string | undefined;
  parent_id?: string | null | undefined;
  name?: string | undefined;
}

export interface DiscordGatewayBot {
  url: string;
  shards: number;
  session_start_limit: {
    total: number;
    remaining: number;
    reset_after: number;
    max_concurrency: number;
  };
}

export interface DiscordApplicationCommand {
  id: string;
  name: string;
  type: number;
  description?: string | undefined;
  contexts?: number[] | null | undefined;
  options?: unknown[] | undefined;
}

export type DiscordApplicationCommandDefinition = (typeof discordCommandDefinitions)[number];

export interface DiscordApiClient {
  getGuild(input: {guildId: string}): Promise<DiscordGuild>;
  getChannel(input: {channelId: string}): Promise<DiscordChannel>;
  leaveGuild(input: {guildId: string}): Promise<void>;
  getGatewayBot(): Promise<DiscordGatewayBot>;
  listApplicationCommands(): Promise<DiscordApplicationCommand[]>;
  overwriteApplicationCommands(input: {
    commands: readonly DiscordApplicationCommandDefinition[];
  }): Promise<DiscordApplicationCommand[]>;
}

export interface CreateDiscordApiClientOptions {
  botToken?: string | undefined;
  baseUrl?: string | undefined;
  applicationId?: string | undefined;
}

interface DiscordRequest {
  operation: string;
  method: 'GET' | 'PUT' | 'DELETE';
  path: string;
  json?: unknown;
}

/**
 * Requests are never retried, including the retries ky applies to GET by default:
 * Discord counts 401, 403, and 429 answers toward an IP-wide block.
 */
export function createDiscordApiClient(
  options: CreateDiscordApiClientOptions = {},
): DiscordApiClient {
  const botToken = options.botToken ?? config.DISCORD_BOT_TOKEN;
  const baseUrl = (options.baseUrl ?? config.DISCORD_API_BASE_URL).replace(TRAILING_SLASHES_RE, '');
  const applicationId = options.applicationId ?? config.DISCORD_APPLICATION_ID;

  async function request<T>(input: DiscordRequest): Promise<T> {
    try {
      const response = await ky(`${baseUrl}${input.path}`, {
        method: input.method,
        headers: {authorization: `Bot ${botToken}`},
        ...(input.json === undefined ? {} : {json: input.json}),
        retry: 0,
        timeout: DISCORD_API_TIMEOUT_MS,
      });
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      throw mapDiscordError(input.operation, error);
    }
  }

  return {
    getGuild: ({guildId}) =>
      request({
        operation: 'get-guild',
        method: 'GET',
        path: `/guilds/${encodeURIComponent(guildId)}`,
      }),
    getChannel: ({channelId}) =>
      request({
        operation: 'get-channel',
        method: 'GET',
        path: `/channels/${encodeURIComponent(channelId)}`,
      }),
    async leaveGuild({guildId}) {
      await request<void>({
        operation: 'leave-guild',
        method: 'DELETE',
        path: `/users/@me/guilds/${encodeURIComponent(guildId)}`,
      });
    },
    getGatewayBot: () =>
      request({operation: 'get-gateway-bot', method: 'GET', path: '/gateway/bot'}),
    listApplicationCommands: () =>
      request({
        operation: 'list-application-commands',
        method: 'GET',
        path: `/applications/${encodeURIComponent(applicationId)}/commands`,
      }),
    overwriteApplicationCommands: ({commands}) =>
      request({
        operation: 'overwrite-application-commands',
        method: 'PUT',
        path: `/applications/${encodeURIComponent(applicationId)}/commands`,
        json: commands,
      }),
  };
}

export function mapDiscordError(
  operation: string,
  error: unknown,
): DiscordIntegrationProviderError {
  if (error instanceof DiscordIntegrationProviderError) return error;
  if (error instanceof HTTPError) return mapDiscordHttpError(operation, error);
  if (error instanceof TimeoutError) {
    logger().warn({operation}, 'Discord API request timed out');
    return new DiscordIntegrationProviderError({
      reason: 'timeout',
      message: 'Discord request timed out',
    });
  }
  logger().warn(
    {operation, errName: error instanceof Error ? error.name : typeof error},
    'Discord API request failed',
  );
  return new DiscordIntegrationProviderError({
    reason: 'provider-unavailable',
    message: 'Discord request failed',
  });
}

function mapDiscordHttpError(operation: string, error: HTTPError): DiscordIntegrationProviderError {
  const {status, headers} = error.response;
  const body = readBody(error.data);
  const discordCode = typeof body.code === 'number' ? body.code : undefined;
  logger().warn({operation, status, discordCode}, 'Discord API request rejected');

  if (status === 401) {
    return new DiscordIntegrationProviderError({
      reason: 'credentials-unavailable',
      message: 'Discord rejected the bot token',
      status,
    });
  }
  if (status === 403) {
    return new DiscordIntegrationProviderError({
      reason: 'access-denied',
      message: 'Discord denied access to the resource',
      status,
      discordCode,
    });
  }
  if (status === 404) {
    return new DiscordIntegrationProviderError({
      reason: 'not-found',
      message: 'Discord resource was not found',
      status,
      discordCode,
    });
  }
  if (status === 429) {
    return new DiscordIntegrationProviderError({
      reason: 'rate-limited',
      message: 'Discord request was rate limited',
      status,
      retryAfterSeconds: retryAfterSeconds(body.retry_after, headers),
    });
  }
  if (status >= 500) {
    return new DiscordIntegrationProviderError({
      reason: 'provider-unavailable',
      message: 'Discord request failed',
      status,
    });
  }
  return new DiscordIntegrationProviderError({
    reason: 'provider-rejected',
    message: 'Discord request was rejected',
    status,
    discordCode,
  });
}

function readBody(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/** Discord sends `retry_after` in the JSON body as fractional seconds. */
function retryAfterSeconds(bodyValue: unknown, headers: Headers): number | undefined {
  if (typeof bodyValue === 'number' && Number.isFinite(bodyValue)) {
    return Math.max(0, Math.ceil(bodyValue));
  }
  const header = Number.parseFloat(headers.get('retry-after') ?? '');
  return Number.isFinite(header) ? Math.max(0, Math.ceil(header)) : undefined;
}

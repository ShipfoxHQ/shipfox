import type {discordCommandDefinitions} from '@shipfox/api-integration-discord-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {z} from 'zod';
import {config} from '#config.js';
import {DiscordIntegrationProviderError} from '#core/errors.js';

export const DISCORD_API_TIMEOUT_MS = 10_000;

const TRAILING_SLASHES_RE = /\/+$/;

export interface DiscordRole {
  id: string;
  name: string;
  managed: boolean;
  /** The granted permission bitfield as a decimal string. */
  permissions?: string | undefined;
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
  topic?: string | null | undefined;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: {id: string; username: string; bot?: boolean | undefined};
  timestamp: string;
  /** Present on a message that started a thread. */
  thread?: {id: string} | undefined;
  [field: string]: unknown;
}

export interface DiscordGuildMember {
  user: {id: string; username: string; global_name?: string | null | undefined; bot?: boolean};
  nick?: string | null | undefined;
  roles: string[];
  joined_at: string;
}

export interface DiscordMessageSearchResult {
  total_results: number;
  /** One group per match: the matching message, flagged `hit: true`, with its neighbors. */
  messages: DiscordMessage[][];
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

export interface DiscordAuthorization {
  /** The installer's user token. It is only needed to revoke it. */
  accessToken: string;
  /** Absent when the person completed the flow without adding the bot to a server. */
  guild: {id: string; name: string} | undefined;
}

export interface DiscordApiClient {
  exchangeAuthorizationCode(input: {code: string}): Promise<DiscordAuthorization>;
  revokeAccessToken(input: {accessToken: string}): Promise<void>;
  getGuild(input: {guildId: string}): Promise<DiscordGuild>;
  getChannel(input: {channelId: string}): Promise<DiscordChannel>;
  getMessage(input: {channelId: string; messageId: string}): Promise<DiscordMessage>;
  /** Newest first, as Discord returns them. */
  listChannelMessages(input: {
    channelId: string;
    limit?: number | undefined;
    before?: string | undefined;
    after?: string | undefined;
  }): Promise<DiscordMessage[]>;
  /** Pings users named in `content` only, never roles or `@everyone`. */
  createMessage(input: {
    channelId: string;
    content: string;
    replyToMessageId?: string | undefined;
  }): Promise<DiscordMessage>;
  startThreadFromMessage(input: {
    channelId: string;
    messageId: string;
    name: string;
  }): Promise<DiscordChannel>;
  /** Threads are not included. */
  listGuildChannels(input: {guildId: string}): Promise<DiscordChannel[]>;
  listActiveGuildThreads(input: {guildId: string}): Promise<DiscordChannel[]>;
  searchGuildMessages(input: {
    guildId: string;
    content: string;
    channelId?: string | undefined;
    authorId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<DiscordMessageSearchResult>;
  getGuildMember(input: {guildId: string; userId: string}): Promise<DiscordGuildMember>;
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
  clientSecret?: string | undefined;
  redirectUrl?: string | undefined;
}

interface DiscordRequest {
  operation: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  /** OAuth endpoints authenticate with the client credentials in the form, not the bot token. */
  form?: Record<string, string>;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  guild: z.object({id: z.string().min(1), name: z.string()}).optional(),
});

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
  const clientSecret = options.clientSecret ?? config.DISCORD_OAUTH_CLIENT_SECRET;
  const redirectUrl = options.redirectUrl ?? config.DISCORD_OAUTH_REDIRECT_URL;

  async function request<T>(input: DiscordRequest): Promise<T> {
    try {
      const response = await ky(`${baseUrl}${input.path}`, {
        method: input.method,
        ...(input.form
          ? {body: new URLSearchParams(input.form)}
          : {
              headers: {authorization: `Bot ${botToken}`},
              ...(input.query === undefined ? {} : {searchParams: definedParams(input.query)}),
              ...(input.json === undefined ? {} : {json: input.json}),
            }),
        retry: 0,
        timeout: DISCORD_API_TIMEOUT_MS,
      });
      if (response.status === 204) return undefined as T;
      // Only guild message search answers 202, while Discord builds the index for a new server.
      if (response.status === 202) {
        throw new DiscordIntegrationProviderError({
          reason: 'rate-limited',
          message: 'Discord is indexing this server',
          status: 202,
          retryAfterSeconds: retryAfterSeconds(
            readBody(await response.json().catch(() => undefined)).retry_after,
            response.headers,
          ),
        });
      }
      return (await response.json()) as T;
    } catch (error) {
      throw mapDiscordError(input.operation, error);
    }
  }

  return {
    async exchangeAuthorizationCode({code}) {
      const body = await request<unknown>({
        operation: 'exchange-authorization-code',
        method: 'POST',
        path: '/oauth2/token',
        form: {
          client_id: applicationId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUrl,
        },
      });
      const parsed = tokenResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new DiscordIntegrationProviderError({
          reason: 'malformed-provider-response',
          message: 'Discord returned an unexpected token response',
        });
      }
      return {accessToken: parsed.data.access_token, guild: parsed.data.guild};
    },
    async revokeAccessToken({accessToken}) {
      await request<unknown>({
        operation: 'revoke-access-token',
        method: 'POST',
        path: '/oauth2/token/revoke',
        form: {
          client_id: applicationId,
          client_secret: clientSecret,
          token: accessToken,
          token_type_hint: 'access_token',
        },
      });
    },
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
    getMessage: ({channelId, messageId}) =>
      request({
        operation: 'get-message',
        method: 'GET',
        path: `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      }),
    listChannelMessages: ({channelId, limit, before, after}) =>
      request({
        operation: 'list-channel-messages',
        method: 'GET',
        path: `/channels/${encodeURIComponent(channelId)}/messages`,
        query: {limit, before, after},
      }),
    createMessage: ({channelId, content, replyToMessageId}) =>
      request({
        operation: 'create-message',
        method: 'POST',
        path: `/channels/${encodeURIComponent(channelId)}/messages`,
        json: {
          content,
          allowed_mentions: {parse: ['users']},
          ...(replyToMessageId === undefined
            ? {}
            : {message_reference: {message_id: replyToMessageId, fail_if_not_exists: false}}),
        },
      }),
    startThreadFromMessage: ({channelId, messageId, name}) =>
      request({
        operation: 'start-thread-from-message',
        method: 'POST',
        path: `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/threads`,
        json: {name},
      }),
    listGuildChannels: ({guildId}) =>
      request({
        operation: 'list-guild-channels',
        method: 'GET',
        path: `/guilds/${encodeURIComponent(guildId)}/channels`,
      }),
    async listActiveGuildThreads({guildId}) {
      const body = await request<{threads: DiscordChannel[]}>({
        operation: 'list-active-guild-threads',
        method: 'GET',
        path: `/guilds/${encodeURIComponent(guildId)}/threads/active`,
      });
      return body.threads;
    },
    searchGuildMessages: ({guildId, content, channelId, authorId, limit, offset}) =>
      request({
        operation: 'search-guild-messages',
        method: 'GET',
        path: `/guilds/${encodeURIComponent(guildId)}/messages/search`,
        query: {content, channel_id: channelId, author_id: authorId, limit, offset},
      }),
    getGuildMember: ({guildId, userId}) =>
      request({
        operation: 'get-guild-member',
        method: 'GET',
        path: `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
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

function definedParams(
  query: Record<string, string | number | undefined>,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    ),
  );
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

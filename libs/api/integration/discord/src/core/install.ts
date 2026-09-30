import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {DiscordApiClient, DiscordRole} from '#api/client.js';
import {config} from '#config.js';
import {withDiscordGuildLock} from '#db/guild-lock.js';
import {DiscordInstallationAlreadyLinkedError} from '#db/installations.js';
import {
  DiscordBotNotInGuildError,
  DiscordInstallStateActorMismatchError,
  DiscordIntegrationProviderError,
  DiscordOAuthCallbackError,
} from './errors.js';
import {signDiscordInstallState, verifyDiscordInstallState} from './state.js';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

/** `bot` adds the bot to the server. `identify` is not needed: the exchange returns `guild`. */
export const DISCORD_INSTALL_SCOPES = 'bot applications.commands';

/**
 * `VIEW_CHANNEL`, `SEND_MESSAGES`, `SEND_MESSAGES_IN_THREADS`, `CREATE_PUBLIC_THREADS`,
 * `READ_MESSAGE_HISTORY`, `ADD_REACTIONS`, and `EMBED_LINKS`.
 */
export const DISCORD_BOT_PERMISSIONS = '309237730368';

export interface ConnectDiscordInstallationInput {
  workspaceId: string;
  guildId: string;
  guildName: string;
  permissions: string;
  installedByDiscordUserId?: string | null | undefined;
  botRoleId?: string | null | undefined;
  displayName?: string | undefined;
  lifecycleStatus?: 'active' | 'error' | undefined;
}

export type WorkspaceMembershipCheck = (input: {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<UserContextMembership>;
}) => Promise<unknown>;

export interface HandleDiscordCallbackParams {
  discord: Pick<DiscordApiClient, 'exchangeAuthorizationCode' | 'revokeAccessToken' | 'getGuild'>;
  code: string;
  state: string;
  stateNonce: string | undefined;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: WorkspaceMembershipCheck;
  getExistingDiscordConnection(input: {
    guildId: string;
  }): Promise<IntegrationConnection<'discord'> | undefined>;
  connectDiscordInstallation(
    input: ConnectDiscordInstallationInput,
  ): Promise<IntegrationConnection<'discord'>>;
  withGuildLock?: typeof withDiscordGuildLock | undefined;
}

export interface DiscordCallbackResult {
  outcome: 'connected' | 'reconnected';
  connection: IntegrationConnection<'discord'>;
}

export function buildDiscordInstallUrl(params: {
  workspaceId: string;
  userId: string;
  nonce: string;
}): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.DISCORD_APPLICATION_ID);
  url.searchParams.set('scope', DISCORD_INSTALL_SCOPES);
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS);
  url.searchParams.set('integration_type', '0');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.DISCORD_OAUTH_REDIRECT_URL);
  url.searchParams.set('state', signDiscordInstallState(params));
  return url.toString();
}

export async function handleDiscordCallback(
  params: HandleDiscordCallbackParams,
): Promise<DiscordCallbackResult> {
  const claims = await verifyClaims(params, params.state);

  // The guild comes from the exchange. The `guild_id` on the callback query is only a hint.
  const authorization = await params.discord.exchangeAuthorizationCode({code: params.code});
  await revokeBestEffort(params.discord, authorization.accessToken);
  if (!authorization.guild) throw new DiscordBotNotInGuildError();
  const guildId = authorization.guild.id;

  const withGuildLock = params.withGuildLock ?? withDiscordGuildLock;
  // Held from the membership check through the commit, so a concurrent disconnect either finishes
  // first (and fails the membership check) or starts after the new records exist.
  return await withGuildLock(guildId, async () => {
    const guild = await getGuildAsBot(params.discord, guildId);
    const botRole = findBotRole(guild.roles);

    const existing = await params.getExistingDiscordConnection({guildId});
    if (existing && existing.workspaceId !== claims.workspaceId) {
      throw new DiscordInstallationAlreadyLinkedError(guildId);
    }

    const connection = await params.connectDiscordInstallation({
      workspaceId: claims.workspaceId,
      guildId,
      guildName: guild.name,
      permissions: botRole?.permissions ?? DISCORD_BOT_PERMISSIONS,
      botRoleId: botRole?.id ?? null,
      lifecycleStatus: 'active',
    });
    return {outcome: existing ? 'reconnected' : 'connected', connection};
  });
}

export async function handleDiscordOAuthCallbackError(params: {
  state: string;
  stateNonce: string | undefined;
  error: string;
  errorDescription?: string | undefined;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: WorkspaceMembershipCheck;
}): Promise<{outcome: 'access_denied'}> {
  await verifyClaims(params, params.state);
  if (params.error === 'access_denied') return {outcome: 'access_denied'};
  throw new DiscordOAuthCallbackError(params.error, params.errorDescription);
}

async function verifyClaims(
  params: Pick<
    HandleDiscordCallbackParams,
    'stateNonce' | 'sessionUserId' | 'sessionMemberships' | 'requireWorkspaceMembership'
  >,
  state: string,
) {
  const claims = verifyDiscordInstallState(state, {nonce: params.stateNonce});
  if (claims.userId !== params.sessionUserId) throw new DiscordInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });
  return claims;
}

async function revokeBestEffort(
  discord: Pick<DiscordApiClient, 'revokeAccessToken'>,
  accessToken: string,
): Promise<void> {
  try {
    await discord.revokeAccessToken({accessToken});
  } catch (error) {
    logger().warn({err: error}, 'Discord user token revoke failed after install');
  }
}

/** A guild the bot cannot read is one it is not in: 404 unknown guild, 403 missing access. */
async function getGuildAsBot(discord: Pick<DiscordApiClient, 'getGuild'>, guildId: string) {
  try {
    return await discord.getGuild({guildId});
  } catch (error) {
    if (
      error instanceof DiscordIntegrationProviderError &&
      (error.status === 403 || error.status === 404)
    ) {
      throw new DiscordBotNotInGuildError();
    }
    throw error;
  }
}

function findBotRole(roles: DiscordRole[]): DiscordRole | undefined {
  return roles.find((role) => role.tags?.bot_id === config.DISCORD_APPLICATION_ID);
}

import {discordCommandDefinitions} from '@shipfox/api-integration-discord-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  createDiscordApiClient,
  type DiscordApiClient,
  type DiscordApplicationCommand,
  type DiscordApplicationCommandDefinition,
} from '#api/client.js';

export interface RegisterDiscordCommandsOptions {
  client?: Pick<DiscordApiClient, 'listApplicationCommands' | 'overwriteApplicationCommands'>;
}

export interface RegisterDiscordCommandsResult {
  overwritten: boolean;
}

/**
 * Overwrites the application's commands only when they differ from the definitions,
 * so replicas that boot together do not each spend Discord's daily command-create budget.
 * The overwrite is idempotent, so two replicas racing on a difference converge.
 */
export async function registerDiscordCommands(
  options: RegisterDiscordCommandsOptions = {},
): Promise<RegisterDiscordCommandsResult> {
  const client = options.client ?? createDiscordApiClient();
  const registered = await client.listApplicationCommands();
  if (discordCommandsMatch(registered, discordCommandDefinitions)) {
    return {overwritten: false};
  }
  await client.overwriteApplicationCommands({commands: discordCommandDefinitions});
  logger().info(
    {commandNames: discordCommandDefinitions.map((command) => command.name)},
    'Discord application commands registered',
  );
  return {overwritten: true};
}

export function discordCommandsMatch(
  registered: readonly DiscordApplicationCommand[],
  definitions: readonly DiscordApplicationCommandDefinition[],
): boolean {
  if (registered.length !== definitions.length) return false;
  return definitions.every((definition) => {
    const existing = registered.find(
      (command) => command.name === definition.name && command.type === definition.type,
    );
    return existing !== undefined && commandSignature(existing) === commandSignature(definition);
  });
}

interface CommandLike {
  description?: string | undefined;
  contexts?: readonly number[] | null | undefined;
  options?: readonly unknown[] | undefined;
}

// Discord fills defaults on read (empty description, `required: false`, ids, versions),
// so only the fields the definitions set are compared.
function commandSignature(command: CommandLike): string {
  return JSON.stringify({
    description: command.description ?? '',
    contexts: [...(command.contexts ?? [])].sort(),
    options: (command.options ?? []).map(optionSignature),
  });
}

function optionSignature(option: unknown) {
  const {name, description, type, required} = option as {
    name?: string;
    description?: string;
    type?: number;
    required?: boolean;
  };
  return {name, description: description ?? '', type, required: required ?? false};
}

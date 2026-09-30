import {discordCommandDefinitions} from '@shipfox/api-integration-discord-dto';
import type {DiscordApplicationCommand} from '#api/client.js';
import {registerDiscordCommands} from './command-registration.js';

function discordEcho(): DiscordApplicationCommand[] {
  return [
    {
      id: '1',
      application_id: 'app',
      version: '2',
      name: 'shipfox',
      type: 1,
      description: 'Start a request with Shipfox.',
      contexts: [0],
      integration_types: [0],
      options: [
        {name: 'prompt', description: 'The request to send to Shipfox.', type: 3, required: true},
      ],
    },
    {id: '3', name: 'Send to Shipfox', type: 3, description: '', contexts: [0]},
  ] as DiscordApplicationCommand[];
}

function createFakeClient(registered: DiscordApplicationCommand[]) {
  return {
    listApplicationCommands: vi.fn().mockResolvedValue(registered),
    overwriteApplicationCommands: vi.fn().mockResolvedValue(registered),
  };
}

describe('registerDiscordCommands', () => {
  it('overwrites the commands when none are registered', async () => {
    const client = createFakeClient([]);

    const result = await registerDiscordCommands({client});

    expect(result).toEqual({overwritten: true});
    expect(client.overwriteApplicationCommands).toHaveBeenCalledWith({
      commands: discordCommandDefinitions,
    });
  });

  it('does not overwrite when Discord returns the definitions with its defaults filled in', async () => {
    const client = createFakeClient(discordEcho());

    const result = await registerDiscordCommands({client});

    expect(result).toEqual({overwritten: false});
    expect(client.overwriteApplicationCommands).not.toHaveBeenCalled();
  });

  it.each([
    ['a command is missing', (commands: DiscordApplicationCommand[]) => commands.slice(0, 1)],
    [
      'an unknown command is registered',
      (commands: DiscordApplicationCommand[]) => [
        ...commands,
        {id: '9', name: 'other', type: 1} as DiscordApplicationCommand,
      ],
    ],
    [
      'a description changed',
      (commands: DiscordApplicationCommand[]) =>
        commands.map((command) => ({...command, description: command.description ? 'Old' : ''})),
    ],
    [
      'a command is allowed in direct messages',
      (commands: DiscordApplicationCommand[]) =>
        commands.map((command) => ({...command, contexts: [0, 1]})),
    ],
    [
      'the prompt option is optional',
      (commands: DiscordApplicationCommand[]) =>
        commands.map((command) =>
          command.options
            ? {...command, options: [{...(command.options[0] as object), required: false}]}
            : command,
        ),
    ],
  ])('overwrites when %s', async (_name, mutate) => {
    const client = createFakeClient(mutate(discordEcho()));

    const result = await registerDiscordCommands({client});

    expect(result).toEqual({overwritten: true});
    expect(client.overwriteApplicationCommands).toHaveBeenCalledTimes(1);
  });

  it('propagates a Discord failure to the startup task runner', async () => {
    const client = createFakeClient([]);
    client.listApplicationCommands.mockRejectedValue(new Error('Discord request failed'));

    await expect(registerDiscordCommands({client})).rejects.toThrow('Discord request failed');
    expect(client.overwriteApplicationCommands).not.toHaveBeenCalled();
  });
});

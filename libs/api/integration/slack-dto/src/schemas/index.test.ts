import {
  createE2eSlackConnectionBodySchema,
  createSlackInstallBodySchema,
  SLACK_APP_UNINSTALLED_EVENT,
  SLACK_PROVIDER,
  SLACK_TOKENS_REVOKED_EVENT,
  slackApiEventTypes,
  slackCallbackQuerySchema,
  slackEventBaseEnvelopeSchema,
  slackEventEnvelopeSchema,
  slackEventNames,
  slackEventPayloadSchema,
  slackEventsRequestSchema,
  slackLifecycleEventTypes,
  slackSlashCommandPayloadSchema,
  slackSlashCommandSchema,
  slackTokensRevokedEventSchema,
  slackUrlVerificationSchema,
} from './index.js';

const eventEnvelope = {
  type: 'event_callback',
  team_id: 'T123',
  api_app_id: 'A123',
  event: {type: 'app_mention', channel: 'C123', user: 'U123', text: 'Hello'},
  event_id: 'Ev123',
  event_time: 1_786_257_600,
};

const slashCommand = {
  token: 'verification-token',
  command: '/deploy',
  team_id: 'T123',
  channel_id: 'C123',
  user_id: 'U123',
  response_url: 'https://hooks.slack.com/commands/123',
  trigger_id: 'trigger-123',
  text: 'production',
};

describe('SLACK_PROVIDER', () => {
  it('names the Slack provider id', () => {
    expect(SLACK_PROVIDER).toBe('slack');
  });
});

describe('Slack event vocabulary', () => {
  it('exports the supported event names without mixing slash commands into API events', () => {
    expect(slackEventNames).toEqual(['app_mention', 'message', 'reaction_added', 'slash_command']);
    expect(slackApiEventTypes).not.toContain('slash_command');
  });

  it('keeps lifecycle events out of published event names', () => {
    expect(slackLifecycleEventTypes).toEqual([
      SLACK_APP_UNINSTALLED_EVENT,
      SLACK_TOKENS_REVOKED_EVENT,
    ]);
    expect(slackApiEventTypes).not.toContain(SLACK_APP_UNINSTALLED_EVENT);
    expect(slackApiEventTypes).not.toContain(SLACK_TOKENS_REVOKED_EVENT);
  });
});

describe('Slack event schemas', () => {
  it('accepts supported Events API envelopes', () => {
    const result = slackEventEnvelopeSchema.parse(eventEnvelope);

    expect(result.event.type).toBe('app_mention');
  });

  it('keeps unsupported Events API envelopes available for record-and-drop handling', () => {
    const unsupportedEvent = {
      ...eventEnvelope,
      event: {type: 'team_join', user: 'U123'},
    };

    expect(slackEventEnvelopeSchema.safeParse(unsupportedEvent).success).toBe(false);
    expect(slackEventBaseEnvelopeSchema.safeParse(unsupportedEvent).success).toBe(true);
  });

  it.each([
    {type: SLACK_TOKENS_REVOKED_EVENT, tokens: {bot: ['UBOT']}},
    {type: SLACK_TOKENS_REVOKED_EVENT, tokens: {oauth: ['UOAUTH']}},
  ])('accepts a tokens_revoked event', (event) => {
    const result = slackTokensRevokedEventSchema.parse(event);

    expect(result.type).toBe(SLACK_TOKENS_REVOKED_EVENT);
  });

  it('accepts the URL verification handshake', () => {
    const payload = {
      type: 'url_verification',
      token: 'verification-token',
      challenge: 'challenge-token',
    };

    expect(slackUrlVerificationSchema.safeParse(payload).success).toBe(true);
    expect(slackEventsRequestSchema.safeParse(payload).success).toBe(true);
  });
});

describe('Slack slash command schema', () => {
  it('accepts a complete form body', () => {
    const result = slackSlashCommandSchema.parse(slashCommand);

    expect(result.command).toBe('/deploy');
  });

  it('defaults an omitted command text to an empty string', () => {
    const {text: _text, ...commandWithoutText} = slashCommand;

    const result = slackSlashCommandSchema.parse(commandWithoutText);

    expect(result.text).toBe('');
  });

  it('rejects a form body without a command', () => {
    const {command: _command, ...commandWithoutCommand} = slashCommand;

    expect(slackSlashCommandSchema.safeParse(commandWithoutCommand).success).toBe(false);
  });

  it('omits the Slack verification token from published command payloads', () => {
    const result = slackSlashCommandPayloadSchema.parse(slashCommand);

    expect(result).not.toHaveProperty('token');
  });
});

describe('Slack payload schemas', () => {
  it('accepts normalized event payloads while retaining Slack-specific fields', () => {
    const result = slackEventPayloadSchema.parse({
      type: 'reaction_added',
      team_id: 'T123',
      api_app_id: 'A123',
      event_id: 'Ev123',
      event_time: 1_786_257_600,
      reaction: 'white_check_mark',
      item: {type: 'message', channel: 'C123', ts: '123.456'},
    });

    expect(result.item).toEqual({type: 'message', channel: 'C123', ts: '123.456'});
  });
});

describe('Slack OAuth and E2E schemas', () => {
  it('rejects an install request with a non-UUID workspace id', () => {
    const result = createSlackInstallBodySchema.safeParse({workspace_id: 'workspace-1'});

    expect(result.success).toBe(false);
  });

  it.each([
    {code: 'grant-code', state: 'signed-state'},
    {error: 'access_denied', state: 'signed-state'},
  ])('accepts Slack callback query %o', (query) => {
    const result = slackCallbackQuerySchema.safeParse(query);

    expect(result.success).toBe(true);
  });

  it('defaults E2E scopes to a representative bot scope set', () => {
    const result = createE2eSlackConnectionBodySchema.parse({
      workspace_id: '5c3583d6-ffb9-4486-a80d-4cf55b567462',
      team_id: 'T123',
      team_name: 'Shipfox',
      app_id: 'A123',
      bot_user_id: 'U123',
      bot_token: 'xoxb-token',
    });

    expect(result.scopes).toEqual(['app_mentions:read', 'chat:write']);
  });
});

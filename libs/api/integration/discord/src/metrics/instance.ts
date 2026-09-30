import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('discord');

export type DiscordGatewayIdentifyOutcome = 'sent' | 'refused_budget';
export type DiscordGatewayResumeOutcome = 'resumed' | 'invalid_session';
export type DiscordGatewayDispatchEvent = 'message_create' | 'message_reaction_add';
export type DiscordGatewayDispatchOutcome =
  | 'processed'
  | 'duplicate'
  | 'connection_unavailable'
  | 'failed';

const identifyCount = meter.createCounter<{outcome: DiscordGatewayIdentifyOutcome}>(
  'integrations_discord_gateway_identifies',
  {description: 'Discord Gateway Identify attempts by outcome'},
);

const resumeCount = meter.createCounter<{outcome: DiscordGatewayResumeOutcome}>(
  'integrations_discord_gateway_resumes',
  {description: 'Discord Gateway session resumes and Invalid Session fallbacks by outcome'},
);

const dispatchCount = meter.createCounter<{
  event: DiscordGatewayDispatchEvent;
  outcome: DiscordGatewayDispatchOutcome;
}>('integrations_discord_gateway_dispatches', {
  description: 'Discord Gateway dispatches by event and handling outcome',
});

// Gauges read process memory when scraped. Only the leader holds a value, so a replica that does
// not lead reports `connected` as 0 and leaves the rest unobserved.
let connected = false;
let identifyRemaining: number | undefined;
let guildCount: number | undefined;
let cursorLagSource: (() => number) | undefined;

meter
  .createObservableGauge('integrations_discord_gateway_connected', {
    description: '1 on the Discord Gateway leader while its socket is ready, otherwise 0',
  })
  .addCallback((result) => result.observe(connected ? 1 : 0));

meter
  .createObservableGauge('integrations_discord_identify_remaining', {
    description: 'Discord session starts left in the current window, from the last /gateway/bot',
  })
  .addCallback((result) => {
    if (identifyRemaining !== undefined) result.observe(identifyRemaining);
  });

meter
  .createObservableGauge('integrations_discord_guilds', {
    description: 'Discord servers the bot is in, from the last READY',
  })
  .addCallback((result) => {
    if (guildCount !== undefined) result.observe(guildCount);
  });

meter
  .createObservableGauge('integrations_discord_gateway_cursor_lag', {
    description: 'Discord Gateway sequences received but not yet committed',
  })
  .addCallback((result) => {
    if (cursorLagSource) result.observe(cursorLagSource());
  });

export function recordDiscordGatewayIdentify(outcome: DiscordGatewayIdentifyOutcome): void {
  identifyCount.add(1, {outcome});
}

export function recordDiscordGatewayResume(outcome: DiscordGatewayResumeOutcome): void {
  resumeCount.add(1, {outcome});
}

export function recordDiscordGatewayDispatch(params: {
  event: DiscordGatewayDispatchEvent;
  outcome: DiscordGatewayDispatchOutcome;
}): void {
  dispatchCount.add(1, params);
}

export function setDiscordGatewayConnected(value: boolean): void {
  connected = value;
}

export function setDiscordIdentifyRemaining(value: number | undefined): void {
  identifyRemaining = value;
}

export function setDiscordGuildCount(value: number | undefined): void {
  guildCount = value;
}

/** Pass `undefined` once the leader stops, so a replica that no longer leads reports nothing. */
export function setDiscordGatewayCursorLagSource(source: (() => number) | undefined): void {
  cursorLagSource = source;
}

export type {
  DiscordGatewayDispatchEvent,
  DiscordGatewayDispatchOutcome,
  DiscordGatewayIdentifyOutcome,
  DiscordGatewayResumeOutcome,
} from './instance.js';
export {
  recordDiscordGatewayDispatch,
  recordDiscordGatewayIdentify,
  recordDiscordGatewayResume,
  setDiscordGatewayConnected,
  setDiscordGatewayCursorLagSource,
  setDiscordGuildCount,
  setDiscordIdentifyRemaining,
} from './instance.js';

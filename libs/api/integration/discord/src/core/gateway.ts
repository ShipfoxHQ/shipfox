import type {ModuleService} from '@shipfox/node-module';
import {
  type DiscordGatewayRun,
  type DiscordGatewayRunOptions,
  startDiscordGatewayRun,
} from './gateway-connection.js';
import {createDiscordGatewayService} from './gateway-service.js';

export type {DiscordGatewayRunOptions} from './gateway-connection.js';
export type {
  DispatchHandler,
  DispatchHandlers,
  GatewayDispatchPayload,
} from './gateway-dispatch-queue.js';

/**
 * The Gateway service: leader election with the shard connection as the leader's work. Each
 * leadership starts a run that resumes from the stored committed cursor and stops it when the
 * lease ends, with a resumable close code.
 */
export function createDiscordGateway(options: DiscordGatewayRunOptions = {}): ModuleService {
  let run: DiscordGatewayRun | undefined;
  return createDiscordGatewayService({
    onLeading: () => {
      run = startDiscordGatewayRun(options);
    },
    onLost: async () => {
      const ended = run;
      run = undefined;
      await ended?.stop();
    },
  });
}

import {DebugSourceControlProvider} from '#core/source-control.js';
import {
  type CreateDebugIntegrationRoutesOptions,
  createDebugIntegrationRoutes,
} from '#presentation/routes/connections.js';

export {DebugSourceControlProvider} from '#core/source-control.js';
export {
  type DebugStartupResyncConnection,
  type DebugStartupResyncDeps,
  emitDebugStartupResync,
  type PublishDebugSourceCommitPushedParams,
} from '#core/startup-resync.js';

export function createDebugIntegrationProvider(options: CreateDebugIntegrationRoutesOptions) {
  return {
    provider: 'debug' as const,
    displayName: 'Debug',
    adapters: {
      source_control: new DebugSourceControlProvider(),
    },
    routes: [createDebugIntegrationRoutes(options)],
  };
}

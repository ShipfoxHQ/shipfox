import {processState} from '@shipfox/node-process-state';
import {Runtime, type RuntimeOptions} from '@temporalio/worker';
import {config} from './config.js';

const runtime = processState(
  '@shipfox/node-temporal/runtime/v1',
  () => ({installed: false}),
  import.meta.url,
);

export function installTemporalRuntime(): void {
  if (runtime.installed || config.OTEL_SDK_DISABLED) return;
  Runtime.install(temporalRuntimeOptions(config.OTEL_TEMPORAL_METRICS_PORT));
  runtime.installed = true;
}

export function temporalRuntimeOptions(metricsPort: number): RuntimeOptions {
  return {
    telemetryOptions: {
      metrics: {
        prometheus: {
          bindAddress: `0.0.0.0:${metricsPort}`,
          countersTotalSuffix: true,
          unitSuffix: true,
        },
        attachServiceName: false,
      },
    },
  };
}

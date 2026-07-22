import {Runtime, type RuntimeOptions} from '@temporalio/worker';
import {config} from './config.js';

let installed = false;

export function installTemporalRuntime(): void {
  if (installed || config.OTEL_SDK_DISABLED) return;
  Runtime.install(temporalRuntimeOptions(config.OTEL_TEMPORAL_METRICS_PORT));
  installed = true;
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

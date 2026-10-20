import {type IMetricReader, MeterProvider} from '@opentelemetry/sdk-metrics';
import {processState} from '@shipfox/node-process-state';
import {config} from '#config.js';
import {
  getMetricsReader,
  getResource,
  type StartInstrumentationOptions,
  shouldStartTelemetry,
} from './common.js';

interface ServiceMetricsState {
  provider?: MeterProvider | undefined;
  reader?: IMetricReader | undefined;
}

const state = processState<ServiceMetricsState>(
  '@shipfox/node-opentelemetry/service-metrics/v1',
  () => ({}),
  import.meta.url,
);

export function startServiceMetrics(options?: StartInstrumentationOptions) {
  if (state.provider) return state.provider;
  if (!shouldStartTelemetry()) {
    state.provider = new MeterProvider();
    return state.provider;
  }

  const resource = getResource(options);
  state.reader = getMetricsReader({
    port: config.OTEL_SERVICE_METRICS_PORT,
    endpoint: '/metrics',
    ...options?.exporter?.service,
  });
  state.provider = new MeterProvider({readers: [state.reader], resource});
  return state.provider;
}

export function getServiceMetricsProvider() {
  if (!state.provider) return startServiceMetrics();
  return state.provider;
}

export async function shutdownServiceMetrics() {
  await state.provider?.shutdown();
  state.provider = new MeterProvider();
  state.reader = undefined;
}

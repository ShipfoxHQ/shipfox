import {createConfig, port, str} from '@shipfox/config';

export const config = createConfig({
  OTEL_INSTANCE_METRICS_PORT: port({
    desc: 'Port that exposes per-instance Prometheus metrics.',
    default: 9464,
  }),
  OTEL_SERVICE_METRICS_PORT: port({
    desc: 'Port that exposes service-wide Prometheus metrics.',
    default: 9474,
  }),
  OTEL_DIAG_LOG_LEVEL: str({
    desc: "Verbosity of OpenTelemetry's own diagnostic logs. Accepts none, error, warn, info, debug, verbose, or all.",
    default: 'none',
  }),
});

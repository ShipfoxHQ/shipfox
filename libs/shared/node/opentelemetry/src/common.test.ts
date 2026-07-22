import {ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION} from '@opentelemetry/semantic-conventions';
import {getResource, shouldExportTraces, shouldStartTelemetry} from './common.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OpenTelemetry configuration', () => {
  it.each([
    {
      name: 'generic endpoint',
      environment: {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: undefined,
        OTEL_SDK_DISABLED: false,
      },
    },
    {
      name: 'trace endpoint',
      environment: {
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.example.com/v1/traces',
        OTEL_SDK_DISABLED: false,
      },
    },
  ])('enables trace export for a $name', ({environment}) => {
    const enabled = shouldExportTraces(environment);

    expect(enabled).toBe(true);
  });

  it('keeps trace export disabled without a standard endpoint', () => {
    const enabled = shouldExportTraces({
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: undefined,
      OTEL_SDK_DISABLED: false,
    });

    expect(enabled).toBe(false);
  });

  it('honors the standard SDK disabled switch', () => {
    const enabled = shouldStartTelemetry({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: undefined,
      OTEL_SDK_DISABLED: true,
    });

    expect(enabled).toBe(false);
  });

  it('adds application resource defaults', () => {
    const resource = getResource({serviceName: 'api', serviceVersion: '1.2.3'});

    expect(resource.attributes).toMatchObject({
      [ATTR_SERVICE_NAME]: 'api',
      [ATTR_SERVICE_VERSION]: '1.2.3',
    });
  });

  it('lets standard deployment resource settings override application defaults', () => {
    vi.stubEnv(
      'OTEL_RESOURCE_ATTRIBUTES',
      'service.name=resource-api,deployment.environment=production',
    );

    const resource = getResource(
      {serviceName: 'api', serviceVersion: '1.2.3'},
      {OTEL_SERVICE_NAME: 'deployment-api'},
    );

    expect(resource.attributes).toMatchObject({
      [ATTR_SERVICE_NAME]: 'deployment-api',
      'deployment.environment': 'production',
    });
  });
});

const telemetry = vi.hoisted(() => ({
  processor: undefined as {onEnd: ReturnType<typeof vi.fn>} | undefined,
  resource: undefined as object | undefined,
}));

const makeWorkflowExporter = vi.hoisted(() => vi.fn());

vi.mock('@shipfox/node-opentelemetry', () => ({
  getInstanceResource: () => telemetry.resource,
  getInstanceSpanProcessor: () => telemetry.processor,
  logger: () => ({error: vi.fn()}),
}));

vi.mock('@temporalio/interceptors-opentelemetry', () => {
  class Interceptor {}

  return {
    makeWorkflowExporter,
    OpenTelemetryActivityInboundInterceptor: Interceptor,
    OpenTelemetryActivityOutboundInterceptor: Interceptor,
    OpenTelemetryWorkflowClientInterceptor: Interceptor,
  };
});

import {
  getClientInterceptors,
  getWorkerInterceptors,
  getWorkflowInterceptorModules,
  getWorkflowSinks,
} from './interceptors.js';

describe('OpenTelemetry interceptors', () => {
  beforeEach(() => {
    telemetry.processor = {onEnd: vi.fn()};
    telemetry.resource = {attributes: {'service.name': 'api'}};
    makeWorkflowExporter.mockImplementation((processor: {onEnd(span: object): void}) => ({
      export: {
        fn: (_info: unknown, spans: object[]) =>
          spans.forEach((span) => {
            processor.onEnd(span);
          }),
      },
    }));
  });

  it('configures client, activity, and workflow propagation', () => {
    const client = getClientInterceptors();
    const worker = getWorkerInterceptors();
    const workflows = getWorkflowInterceptorModules();

    expect(client.workflow).toHaveLength(1);
    expect(worker.activity).toHaveLength(1);
    expect(worker.activityInbound).toHaveLength(1);
    expect(workflows).toHaveLength(2);
  });

  it('keeps workflow export safe when tracing is disabled', () => {
    telemetry.processor = undefined;
    telemetry.resource = undefined;

    const sinks = getWorkflowSinks();

    expect(() => sinks.exporter.export.fn({} as never, [])).not.toThrow();
    expect(makeWorkflowExporter).not.toHaveBeenCalled();
  });

  it('forwards workflow spans to the process span processor', () => {
    const legacySpan = {
      instrumentationLibrary: {name: 'workflow'},
      parentSpanId: 'parent-span',
      spanContext: () => ({traceId: 'trace', spanId: 'span', traceFlags: 1}),
    };
    const sinks = getWorkflowSinks();

    sinks.exporter.export.fn({} as never, [legacySpan] as never);

    expect(telemetry.processor?.onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        instrumentationScope: legacySpan.instrumentationLibrary,
        parentSpanContext: expect.objectContaining({spanId: 'parent-span'}),
      }),
    );
  });
});

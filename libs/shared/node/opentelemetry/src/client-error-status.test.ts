import {SpanStatusCode} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import {ClientErrorStatusSpanProcessor} from './client-error-status.js';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new ClientErrorStatusSpanProcessor(), new SimpleSpanProcessor(exporter)],
});

afterEach(() => exporter.reset());

function failSpan(scope: string, error: Error): void {
  const span = provider.getTracer(scope).startSpan('request');
  span.setStatus({code: SpanStatusCode.ERROR, message: error.message});
  span.recordException(error);
  span.end();
}

describe('ClientErrorStatusSpanProcessor', () => {
  it('leaves a Fastify span unset for a client error and records the reason as attributes', () => {
    failSpan(
      '@fastify/otel',
      Object.assign(new Error('body is invalid'), {statusCode: 400, code: 'FST_ERR_VALIDATION'}),
    );

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    expect(span?.events).toEqual([]);
    expect(span?.attributes).toMatchObject({
      'error.type': 'FST_ERR_VALIDATION',
      'error.message': 'body is invalid',
    });
  });

  it('keeps the error status and exception event for a server error', () => {
    failSpan('@fastify/otel', new Error('database unavailable'));

    const [span] = exporter.getFinishedSpans();
    expect(span?.status).toEqual({code: SpanStatusCode.ERROR, message: 'database unavailable'});
    expect(span?.events.map((event) => event.name)).toEqual(['exception']);
  });

  it('keeps the error status for an error that carries a 5xx status code', () => {
    failSpan('@fastify/otel', Object.assign(new Error('upstream failed'), {statusCode: 502}));

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.map((event) => event.name)).toEqual(['exception']);
  });

  it('uses the status code as the error type when a client error has no code', () => {
    failSpan('@fastify/otel', Object.assign(new Error('gone'), {statusCode: 410}));

    expect(exporter.getFinishedSpans()[0]?.attributes['error.type']).toBe('410');
  });

  it('leaves spans from other instrumentations unchanged', () => {
    failSpan(
      '@opentelemetry/instrumentation-http',
      Object.assign(new Error('bad'), {statusCode: 400}),
    );

    expect(exporter.getFinishedSpans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

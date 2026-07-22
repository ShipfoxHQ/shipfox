import {createRequire} from 'node:module';
import {getInstanceResource, getInstanceSpanProcessor} from '@shipfox/node-opentelemetry';
import type {ClientInterceptors} from '@temporalio/client';
import {
  makeWorkflowExporter,
  OpenTelemetryActivityInboundInterceptor,
  OpenTelemetryActivityOutboundInterceptor,
  type OpenTelemetrySinks,
  OpenTelemetryWorkflowClientInterceptor,
} from '@temporalio/interceptors-opentelemetry';
import type {InjectedSinks, WorkerInterceptors} from '@temporalio/worker';

const require = createRequire(import.meta.url);
const workflowInterceptorModule = require.resolve(
  '@temporalio/interceptors-opentelemetry/lib/workflow-interceptors',
);

export function getClientInterceptors(): ClientInterceptors {
  return {workflow: [new OpenTelemetryWorkflowClientInterceptor()]};
}

export function getWorkerInterceptors(): WorkerInterceptors {
  return {
    activity: [
      (context) => ({
        inbound: new OpenTelemetryActivityInboundInterceptor(context),
        outbound: new OpenTelemetryActivityOutboundInterceptor(context),
      }),
    ],
  };
}

export function getWorkflowInterceptorModules(): string[] {
  return [workflowInterceptorModule];
}

export function getWorkflowSinks(): InjectedSinks<OpenTelemetrySinks> {
  const processor = getInstanceSpanProcessor();
  const resource = getInstanceResource();
  if (!processor || !resource) {
    return {exporter: {export: {fn: () => undefined}}};
  }

  // @temporalio/interceptors-opentelemetry pins an older @opentelemetry/api ReadableSpan shape
  // (instrumentationLibrary/parentSpanId instead of instrumentationScope/parentSpanContext), so
  // the cast and field translation below bridge it to the current SDK's SpanProcessor#onEnd.
  const exporterFactory = makeWorkflowExporter as unknown as (
    spanProcessor: {onEnd(span: LegacyReadableSpan): void},
    resource: unknown,
  ) => InjectedSinks<OpenTelemetrySinks>['exporter'];

  return {
    exporter: exporterFactory(
      {
        onEnd: (span) => {
          const spanContext = span.spanContext();
          processor.onEnd({
            ...span,
            instrumentationScope: span.instrumentationLibrary,
            parentSpanContext: span.parentSpanId
              ? {...spanContext, spanId: span.parentSpanId}
              : undefined,
          } as never);
        },
      },
      resource,
    ),
  };
}

interface LegacyReadableSpan {
  instrumentationLibrary: {name: string; version?: string; schemaUrl?: string};
  parentSpanId?: string;
  spanContext(): {traceId: string; spanId: string; traceFlags: number; traceState?: unknown};
}

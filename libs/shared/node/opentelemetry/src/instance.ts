import type {IncomingMessage} from 'node:http';
import otel from '@fastify/otel';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import type {Instrumentation} from '@opentelemetry/instrumentation';
import type {HttpInstrumentationConfig} from '@opentelemetry/instrumentation-http';
import type {PgInstrumentationConfig} from '@opentelemetry/instrumentation-pg';
import type {Resource} from '@opentelemetry/resources';
import {AggregationType, type ViewOptions} from '@opentelemetry/sdk-metrics';
import {NodeSDK} from '@opentelemetry/sdk-node';
import type {SpanProcessor} from '@opentelemetry/sdk-trace-node';
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-node';
import {config} from '#config.js';
import {ClientErrorStatusSpanProcessor} from './client-error-status.js';
import {
  getMetricsReader,
  getResource,
  type InstrumentationOptions,
  type StartInstrumentationOptions,
  shouldExportTraces,
  shouldStartTelemetry,
} from './common.js';
import {fastifyRequestHook} from './utils.js';

const {FastifyOtelInstrumentation} = otel;

let instanceInstrumentation: NodeSDK | undefined;
let fastifyInstrumentation: InstanceType<typeof FastifyOtelInstrumentation> | undefined;
let instanceResource: Resource | undefined;
let instanceSpanProcessor: SpanProcessor | undefined;

// Queries outside a request, job, or dispatch span come from background polling. Tracing them
// turns every poll into its own one-span trace.
const pgConfig: PgInstrumentationConfig = {requireParentSpan: true};

// Fastify records per-route request duration. The generic server histogram duplicates it and
// also counts Prometheus scrapes.
const views: ViewOptions[] = ['http.server.duration', 'http.server.request.duration'].map(
  (instrumentName) => ({
    meterName: '@opentelemetry/instrumentation-http',
    instrumentName,
    aggregation: {type: AggregationType.DROP},
  }),
);

function createHttpConfig(metricsPorts: number[]): HttpInstrumentationConfig {
  return {
    ignoreIncomingRequestHook: (request: IncomingMessage) =>
      metricsPorts.includes(request.socket.localPort ?? -1),
  };
}

async function resolveInstrumentations(
  options: InstrumentationOptions,
  httpConfig: HttpInstrumentationConfig,
): Promise<Instrumentation[]> {
  const {
    fastify = true,
    http,
    net,
    dns,
    pg,
    ioredis,
    undici,
    awsSdk,
    cassandraDriver,
    grpc,
    pino,
  } = options;
  const instrumentations: Instrumentation[] = [];

  if (fastify) {
    fastifyInstrumentation = new FastifyOtelInstrumentation({requestHook: fastifyRequestHook});
    instrumentations.push(fastifyInstrumentation);
  }
  if (http) {
    const {HttpInstrumentation} = await import('@opentelemetry/instrumentation-http');
    instrumentations.push(new HttpInstrumentation(httpConfig));
  }
  if (net) {
    const {NetInstrumentation} = await import('@opentelemetry/instrumentation-net');
    instrumentations.push(new NetInstrumentation());
  }
  if (dns) {
    const {DnsInstrumentation} = await import('@opentelemetry/instrumentation-dns');
    instrumentations.push(new DnsInstrumentation());
  }
  if (pg) {
    const {PgInstrumentation} = await import('@opentelemetry/instrumentation-pg');
    instrumentations.push(new PgInstrumentation(pgConfig));
  }
  if (ioredis) {
    const {IORedisInstrumentation} = await import('@opentelemetry/instrumentation-ioredis');
    instrumentations.push(new IORedisInstrumentation());
  }
  if (undici) {
    const {UndiciInstrumentation} = await import('@opentelemetry/instrumentation-undici');
    instrumentations.push(new UndiciInstrumentation());
  }
  if (awsSdk) {
    const {AwsInstrumentation} = await import('@opentelemetry/instrumentation-aws-sdk');
    instrumentations.push(new AwsInstrumentation());
  }
  if (cassandraDriver) {
    const {CassandraDriverInstrumentation} = await import(
      '@opentelemetry/instrumentation-cassandra-driver'
    );
    instrumentations.push(new CassandraDriverInstrumentation());
  }
  if (grpc) {
    const {GrpcInstrumentation} = await import('@opentelemetry/instrumentation-grpc');
    instrumentations.push(new GrpcInstrumentation());
  }
  if (pino) {
    const {PinoInstrumentation} = await import('@opentelemetry/instrumentation-pino');
    instrumentations.push(new PinoInstrumentation());
  }

  return instrumentations;
}

export async function startInstanceInstrumentation(options: StartInstrumentationOptions) {
  if (instanceInstrumentation) throw new Error('Instrumentation already initialized');
  if (!shouldStartTelemetry()) return;
  const instanceExporter = {
    port: config.OTEL_INSTANCE_METRICS_PORT,
    endpoint: '/metrics',
    ...options.exporter?.instance,
  };
  const metricReader = getMetricsReader(instanceExporter);
  const httpConfig = createHttpConfig([
    instanceExporter.port,
    options.exporter?.service.port ?? config.OTEL_SERVICE_METRICS_PORT,
  ]);

  let instrumentations: Instrumentation[];
  if (options.instrumentations === undefined) {
    fastifyInstrumentation = new FastifyOtelInstrumentation({requestHook: fastifyRequestHook});
    const {getNodeAutoInstrumentations} = await import('@opentelemetry/auto-instrumentations-node');
    instrumentations = [
      fastifyInstrumentation,
      ...getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': httpConfig,
        '@opentelemetry/instrumentation-pg': pgConfig,
      }),
    ];
  } else {
    instrumentations = await resolveInstrumentations(options.instrumentations, httpConfig);
  }

  instanceResource = getResource(options);
  const sdkConfig: ConstructorParameters<typeof NodeSDK>[0] = {
    resource: instanceResource,
    metricReader,
    views,
    instrumentations,
  };
  if (shouldExportTraces()) {
    instanceSpanProcessor = new BatchSpanProcessor(new OTLPTraceExporter());
    sdkConfig.spanProcessors = [new ClientErrorStatusSpanProcessor(), instanceSpanProcessor];
  }
  instanceInstrumentation = new NodeSDK(sdkConfig);
  instanceInstrumentation.start();
}

export function getInstanceResource(): Resource | undefined {
  return instanceResource;
}

export function getInstanceSpanProcessor(): SpanProcessor | undefined {
  return instanceSpanProcessor;
}

export function getFastifyInstrumentation():
  | InstanceType<typeof FastifyOtelInstrumentation>
  | undefined {
  return fastifyInstrumentation;
}

export async function shutdownInstanceInstrumentation() {
  await instanceInstrumentation?.shutdown();
  instanceInstrumentation = undefined;
  instanceResource = undefined;
  instanceSpanProcessor = undefined;
  fastifyInstrumentation = undefined;
}

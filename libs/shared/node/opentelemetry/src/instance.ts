import otel from '@fastify/otel';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import type {Instrumentation} from '@opentelemetry/instrumentation';
import type {Resource} from '@opentelemetry/resources';
import {NodeSDK} from '@opentelemetry/sdk-node';
import type {SpanProcessor} from '@opentelemetry/sdk-trace-node';
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-node';
import {config} from '#config.js';
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

async function resolveInstrumentations(
  options: InstrumentationOptions,
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
    instrumentations.push(new HttpInstrumentation());
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
    instrumentations.push(new PgInstrumentation());
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
  const metricReader = getMetricsReader({
    port: config.OTEL_INSTANCE_METRICS_PORT,
    endpoint: '/metrics',
    ...options.exporter?.instance,
  });

  let instrumentations: Instrumentation[];
  if (options.instrumentations === undefined) {
    fastifyInstrumentation = new FastifyOtelInstrumentation({requestHook: fastifyRequestHook});
    const {getNodeAutoInstrumentations} = await import('@opentelemetry/auto-instrumentations-node');
    instrumentations = [fastifyInstrumentation, ...getNodeAutoInstrumentations()];
  } else {
    instrumentations = await resolveInstrumentations(options.instrumentations);
  }

  instanceResource = getResource(options);
  const sdkConfig: ConstructorParameters<typeof NodeSDK>[0] = {
    resource: instanceResource,
    metricReader,
    instrumentations,
  };
  if (shouldExportTraces()) {
    instanceSpanProcessor = new BatchSpanProcessor(new OTLPTraceExporter());
    sdkConfig.spanProcessors = [instanceSpanProcessor];
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

import {type Attributes, SpanStatusCode, trace} from '@shipfox/node-opentelemetry';

/**
 * Runs provisioner work inside an active span so its provider and API calls share one trace.
 * Loops read state without tracing and call this only once a pass has something to do.
 */
export async function withWorkSpan<Result>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<Result>,
): Promise<Result> {
  const tracer = trace.getTracer('@shipfox/provisioner-core');
  return await tracer.startActiveSpan(name, {attributes}, async (span) => {
    try {
      return await operation();
    } catch (error) {
      span.setStatus({code: SpanStatusCode.ERROR});
      throw error;
    } finally {
      span.end();
    }
  });
}

import {
  type Context,
  createContextKey,
  context as otelContext,
  propagation,
  type Span,
  trace,
} from '@opentelemetry/api';
import {suppressTracing} from '@opentelemetry/core';

export function contextWithMetadata(
  metadata: Record<string, string>,
  options?: {parentContext?: Context},
): Context {
  let ctx = options?.parentContext ?? otelContext.active();
  let baggage = propagation.getBaggage(ctx) ?? propagation.createBaggage();

  for (const [key, value] of Object.entries(metadata)) {
    ctx = ctx.setValue(createContextKey(key), value);
    baggage = baggage.setEntry(key, {value});
  }

  ctx = propagation.setBaggage(ctx, baggage);
  return ctx;
}

export function getContextMetadata(ctx?: Context): Record<string, string> {
  const resolvedCtx = ctx ?? otelContext.active();

  const baggage = propagation.getBaggage(resolvedCtx);
  if (!baggage) return {};

  const result: Record<string, string> = {};

  for (const [key, entry] of baggage.getAllEntries()) {
    const contextValue = resolvedCtx.getValue(createContextKey(key));
    result[key] = typeof contextValue === 'string' ? contextValue : entry.value;
  }

  return result;
}

export function enrichSpanWithMetadata(
  metadata?: Record<string, string>,
  options?: {span?: Span},
): void {
  const span = options?.span ?? trace.getActiveSpan();
  if (!span) return;

  const resolvedMetadata = metadata ?? getContextMetadata();

  for (const [key, value] of Object.entries(resolvedMetadata)) {
    span.setAttribute(key, value);
  }
}

/** Runs `fn` without creating spans, for example for repeated reads inside a long poll. */
export function withoutTracing<T>(fn: () => T): T {
  return otelContext.with(suppressTracing(otelContext.active()), fn);
}
